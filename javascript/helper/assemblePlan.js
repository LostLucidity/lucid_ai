//@ts-check
"use strict"

const { ASSIMILATOR, PYLON, WARPGATE } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions, getAvailableExpansions } = require("./expansions");
const placementConfigs = require("./placement-configs");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { frontOfGrid } = require("@node-sc2/core/utils/map/region");
const buildWorkers = require("./build-workers");
const { MOVE } = require("@node-sc2/core/constants/ability");
const canAfford = require("./can-afford");
const isSupplyNeeded = require("./supply");
const rallyUnits = require("./rally-units");
const { workerSendOrBuild } = require("../builds/protoss/helper");
const shortOnWorkers = require("./short-on-workers");
const { WarpUnitAbility } = require("@node-sc2/core/constants");
const continuouslyBuild = require("./continuously-build");
const balanceResources = require("./balance-resources");
const { TownhallRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const { defend, attack } = require("./army-behavior");
const baseThreats = require("./base-threats");
const defenseSetup = require("../builds/protoss/defense-setup");

let actions;
let race;
let ATTACKFOOD = 194;

class AssemblePlan {
  constructor(plan) {
    this.foundPosition = null;
    this.planOrder = plan.order;
    this.mainCombatTypes = plan.unitTypes.mainCombatTypes;
    this.defenseTypes = plan.unitTypes.defenseTypes;
    this.supportUnitTypes = plan.unitTypes.supportUnitTypes;
  }
  onGameStart(world) {
    actions = world.resources.get().actions;
    race = world.agent.race;
  }
  async onStep(world, state) {
    this.collectedActions = [];
    this.state = state;
    this.world = world;
    this.agent = world.agent;
    this.data = world.data;
    this.foodUsed = this.world.agent.foodUsed
    this.resources = world.resources;
    this.map = this.resources.get().map;
    this.units = this.resources.get().units;
    baseThreats(this.resources, this.state);
    await this.runPlan();
    this.collectedActions.push(...rallyUnits(this.resources, this.supportUnitTypes));
    if (this.state.defenseMode && this.foodUsed < ATTACKFOOD) { this.collectedActions.push(...defend(this.resources, this.mainCombatTypes, this.supportUnitTypes)); }
    if (this.agent.minerals > 512) { balanceResources(world.agent, world.data, world.resources); }
    if (this.foodUsed >= 132 && !shortOnWorkers(this.resources)) { await this.expand(); }
    if (this.foodUsed >= ATTACKFOOD) { this.collectedActions.push(...attack(this.resources, this.mainCombatTypes, this.supportUnitTypes)); }
    defenseSetup(world, this.state);
    this.checkEnemyBuild();
    await actions.sendAction(this.collectedActions);
  }
  ability(foodRanges, abilityId, unitTypeTarget, targetCount, unitTypes) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (typeof targetCount !== 'undefined') {
        if (this.units.getById(unitTypes).length !== targetCount) {
          return;
        } 
      }
      let canDoTypes = this.data.findUnitTypesWithAbility(abilityId);
      if (canDoTypes.length === 0) {
        canDoTypes = this.units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
      }
      const unitsCanDo = this.units.getByType(canDoTypes).filter(u => u.abilityAvailable(abilityId));
      let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
      if (unitCanDo) {
        const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
        if (unitTypeTarget) {
          const targets = this.units.getById(unitTypeTarget).filter(unit => !unit.noQueue && unit.buffIds.indexOf(281) === -1);
          let target = targets[Math.floor(Math.random() * targets.length)];
          if (target) { unitCommand.targetUnitTag = target.tag; }
        }
        this.collectedActions.push(unitCommand);
      }
    }
  }
  async build(food, unitType, targetCount, candidatePositions) {
    const placementConfig = placementConfigs[unitType];
    if (this.foodUsed >= food) {
      if (this.checkBuildingCount(targetCount, placementConfig)) {
        const toBuild = placementConfigs[unitType].toBuild;
        if (GasMineRace[race] === toBuild && this.agent.canAfford(toBuild)) { await actions.buildGasMine(); }
        else if (TownhallRace[race].indexOf(toBuild) > -1 ) { await this.expand(); } 
        else {
          if (!candidatePositions) { candidatePositions = this.findPlacements(placementConfig) }
          await this.buildBuilding(placementConfig, candidatePositions);
        }
      }
    }
  }
  async buildWorkers(foodRanges, controlled=false) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (controlled) {
        if (!this.state.defenseMode && this.agent.minerals < 512 && shortOnWorkers(this.resources)) {
          try { await buildWorkers(this.agent, this.data, this.world.resources); } catch(error) { console.log(error); }
        }
      } else {
        try { await buildWorkers(this.agent, this.data, this.world.resources); } catch(error) { console.log(error); }
      }
    }
  }
  async buildBuilding(placementConfig, candidatePositions) {
    // find placement on main
    this.foundPosition = await this.findPosition(actions, placementConfig.placement, candidatePositions);
    if (this.foundPosition ) {
      if (this.agent.canAfford(placementConfig.toBuild)) {
        this.collectedActions.push(...workerSendOrBuild(this.units, this.data.getUnitTypeData(placementConfig.toBuild).abilityId, this.foundPosition));
        this.state.pauseBuilding = false;
      } else {
        this.collectedActions.push(...workerSendOrBuild(this.units, MOVE, this.foundPosition));
        this.state.pauseBuilding = true;
      }
    } else {
      const [ pylon ] = this.units.getById(PYLON);
      if (pylon) {
        this.collectedActions.push(...workerSendOrBuild(this.units, MOVE, pylon.pos));
        this.state.pauseBuilding = true;
      }
    }
  }
  checkBuildingCount(targetCount, placementConfig) {
    const buildAbilityId = this.data.getUnitTypeData(placementConfig.toBuild).abilityId;
    let count = this.units.withCurrentOrders(buildAbilityId).length;
    placementConfig.countTypes.forEach(type => {
      let unitsToCount = this.units.getById(type);
      if (race === Race.TERRAN) {
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= 1);
      }
      count += unitsToCount.length;
    });
    return count === targetCount;
  }
  checkEnemyBuild() {
    const { frame, } = this.resources.get();
    // if scouting probe and time is greater than 2 minutes. If no base, stay defensive.
    if (
      frame.timeInSeconds() > 132
      && frame.timeInSeconds() <= 240
    ) {
      if (this.units.getBases(Alliance.ENEMY).length < 2) {
        this.state.enemyBuildType = 'cheese';
      };
    }
  }
  async expand() {
    const expansionLocation = getAvailableExpansions(this.resources)[0].townhallPosition;
    const townhallType = TownhallRace[this.agent.race][0];
    if (canAfford(this.agent, this.data, townhallType)) {
      const foundPosition = await actions.canPlace(TownhallRace[this.agent.race][0], [expansionLocation]);
      if (foundPosition) {
        const buildAbilityId = this.data.getUnitTypeData(townhallType).abilityId;
        if ((this.units.inProgress(townhallType).length + this.units.withCurrentOrders(buildAbilityId).length) < 1 ) {
          this.collectedActions.push(...workerSendOrBuild(this.units, this.data.getUnitTypeData(townhallType).abilityId, expansionLocation));
          this.state.pauseBuilding = false;
        }
      }
    } else {
      this.collectedActions.push(...workerSendOrBuild(this.units, MOVE, expansionLocation));
      this.state.pauseBuilding = true;
    }
  }
  findPlacements(placementConfig) {
    const { map } = this.world.resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    let placements = [];
    if (race === Race.PROTOSS) {
      if (placementConfig.toBuild === PYLON) {
        placements = [...main.areas.placementGrid, ...natural.areas.placementGrid]
          .filter((point) => {
            return (
              (distance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
              (natural.areas.hull.every(hp => distance(hp, point) > 3)) &&
              (this.units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => distance(eb, point) > 3))
            );
          });
      } else {
        let pylonsNearProduction;
        if (this.units.getById(PYLON).length === 1) {
          pylonsNearProduction = this.units.getById(PYLON);
        } else {
          pylonsNearProduction = this.units.getById(PYLON)
            .filter(u => u.buildProgress >= 1)
            .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);
        }
        pylonsNearProduction.forEach(pylon => {
          placements.push(...gridsInCircle(pylon.pos, 6.5));
        })
        // getOccupiedExpansions(resources).forEach(expansion => {
        //   placements.push(...expansion.areas.placementGrid);
        // });
        placements = placements.filter((point) => {
          return (
            (distance(natural.townhallPosition, point) > 4.5) &&
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (natural.areas.hull.every(hp => distance(hp, point) > 2)) &&
            (this.units.getStructures({ alliance: Alliance.SELF })
              .map(u => u.pos)
              .every(eb => distance(eb, point) > 3))
          );
        });
      }
    } else if (race === Race.TERRAN) {
      // placements = main.areas.placementGrid
      //   .filter((point) => {
      //     return (
      //       (mainMineralLine.every((mlp) => {
      //         return ((distanceX(mlp, point) >= 5 || distanceY(mlp, point) >= 1.5)); // for addon room
      //       })) &&
      //       (main.areas.hull.every((hp) => {
      //         return ((distanceX(hp, point) >= 3.5 || distanceY(hp, point) >= 1.5));
      //       })) &&
      //       (units.getStructures({ alliance: Alliance.SELF })
      //         .map(u => u.pos)
      //         .every((eb) => {
      //           return (
      //             (distanceX(eb, point) >= 5 || distanceY(eb, point) >= 3) // for addon room
      //           );
      //         })
      //       )
      //     );
      // });
      const placementGrids = [];
      getOccupiedExpansions(this.world.resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      placements = placementGrids
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20); 
    } else if (race === Race.ZERG) {
      placements = map.getCreep()
        .filter((point) => {
          return (
            (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
            (this.units.getStructures({ alliance: Alliance.SELF })
              .map(u => u.pos)
              .every(eb => distance(eb, point) > 3))
          );
        });
    }
    return placements;
  }
  findSupplyPositions() {
    const { map } = this.resources.get();
    const myExpansions = map.getOccupiedExpansions(Alliance.SELF);
    // front of natural pylon for great justice
    const naturalWall = map.getNatural().getWall();
    let possiblePlacements = frontOfGrid(this.world, map.getNatural().areas.areaFill)
        .filter(point => naturalWall.every(wallCell => (
            (distance(wallCell, point) <= 6.5) &&
            (distance(wallCell, point) >= 3)
        )));
  
    if (possiblePlacements.length <= 0) {
        possiblePlacements = frontOfGrid(this.world, map.getNatural().areas.areaFill)
            .map(point => {
                point.coverage = naturalWall.filter(wallCell => (
                    (distance(wallCell, point) <= 6.5) &&
                    (distance(wallCell, point) >= 1)
                )).length;
                return point;
            })
            .sort((a, b) => b.coverage - a.coverage)
            .filter((cell, i, arr) => cell.coverage === arr[0].coverage);
    }
  
    return possiblePlacements;
  }
  async findPosition(actions, unitType, candidatePositions) {
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    return await actions.canPlace(unitType, randomPositions);
  }
  getBuilders() {
    
  }
  async manageSupply(foodRanges) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (isSupplyNeeded(this.agent, this.data, this.resources)) {
        switch (race) {
          case Race.PROTOSS:
            await this.build(this.foodUsed, 'PYLON', this.units.getById(PYLON).length)
        }
      }
    }
  }
  scout(foodRanges, unitType, targetLocation, conditions, ) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      const label = 'scout';
      if (this.units.withLabel(label).length === 0) {
        if (conditions && this.units.getByType(unitType).length === conditions.unitCount) {
          this.setScout(unitType, label, this.map[targetLocation]());
        } else {
          this.setScout(unitType, label, this.map[targetLocation]());
        }
      }
      const [ scout ] = this.units.withLabel(label);
      if (scout) { 
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: this.map[targetLocation]().townhallPosition,
          unitTags: [ scout.tag ],
        }
        this.collectedActions.push(unitCommand);
      }
    }
  }

  setScout(unitType, label, location) {
    const [ unit ] = this.units.getById(unitType);
    if (unit) {
      let [ scout ] = this.units.getClosest(location, this.units.getById(unitType).filter(w => w.noQueue));
      if (!scout) { [ scout ] = this.units.getClosest(location, this.units.getById(unitType)) }
      if (scout) {
        scout.labels.clear();
        scout.labels.set(label, true);
      }
    }
  }
  async train(food, unitType, targetCount) {
    if (this.foodUsed >= food) {
      let abilityId = this.data.getUnitTypeData(unitType).abilityId;
      const unitCount = this.units.getById(unitType).length + this.units.withCurrentOrders(abilityId).length
      if (unitCount === targetCount) {
        if (canAfford(this.agent, this.world.data, unitType)) {
          const trainer = this.units.getProductionUnits(unitType).find(unit => unit.noQueue);
          if (trainer) {
            const unitCommand = {
              abilityId,
              unitTags: [ trainer.tag ],
            }
            this.collectedActions.push(unitCommand);
          } else {
            abilityId = WarpUnitAbility[unitType]
            const warpGates = this.units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
            if (warpGates.length > 0) {
              try { await actions.warpIn(unitType) } catch (error) { console.log(error); }
            }
          }
        }
        this.state.pauseBuilding = this.collectedActions.length === 0;
      }
    }
  }
  upgrade(food, upgradeId) {
    if (this.foodUsed >= food) {
      const { abilityId } = this.data.getUpgradeData(upgradeId);
      const upgrader = this.units.getUpgradeFacilities(upgradeId).find(u => u.noQueue && u.availableAbilities(abilityId));
      if (upgrader) {
        this.collectedActions.push({ abilityId, unitTags: [upgrader.tag] });
      }
    }
  }
  
  async runPlan() {
    for (let step = 0; step < this.planOrder.length; step++) {
      const planStep = this.planOrder[step];
      let targetCount = planStep[3];
      const foodTarget = planStep[0];
      let unitType;
      switch (planStep[1]) {
        case 'ability':
          const abilityId = planStep[2];
          this.ability(foodTarget, abilityId, targetCount, planStep[4], planStep[5]);
          break;
        case 'build':
          unitType = planStep[2];
          await this.build(foodTarget, unitType, targetCount, planStep[4] ? this[planStep[4]]() : null);
          break;
        case 'buildWorkers': if (!this.state.pauseBuilding) { await this.buildWorkers(planStep[0], planStep[2] ? planStep[2] : null); } break;
        case 'continuouslyBuild': if (this.agent.minerals > 512) { await continuouslyBuild(this.agent, this.data, this.resources, this.mainCombatTypes); } break;
        case 'manageSupply': await this.manageSupply(planStep[0]); break;
        case 'train':
          unitType = planStep[2];
          try { await this.train(foodTarget, unitType, targetCount); } catch(error) { console.log(error) } break;
        case 'scout':
          unitType = planStep[2];
          const targetLocation = planStep[3];
          const conditions = planStep[4];
          this.scout(foodTarget, unitType, targetLocation, conditions, );
          break;
        case 'upgrade':
          const upgradeId = planStep[2];
          this.upgrade(foodTarget, upgradeId);
          break;
      }
    }
  }
  workerSendOrBuild(ability, position) {
    const builders = [
      ...this.units.getMineralWorkers(),
      ...this.units.getWorkers().filter(w => w.noQueue),
      ...this.units.withLabel('builder').filter(w => !w.isConstructing()),
      ...this.units.withLabel('proxy').filter(w => !w.isConstructing()),
    ];
    const [ builder ] = this.units.getClosest(position, builders);
    if (builder) {
      builder.labels.set('builder', true);
      if (builder) {
        const unitCommand = {
          abilityId: ability,
          unitTags: [builder.tag],
          targetWorldSpacePos: position,
        };
        this.collectedActions.push(unitCommand);
      }
    }
  }
}

module.exports = AssemblePlan;