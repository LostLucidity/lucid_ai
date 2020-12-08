//@ts-check
"use strict"

const { PYLON, WARPGATE, OVERLORD, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions } = require("./expansions");
const placementConfigs = require("./placement-configs");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { frontOfGrid } = require("@node-sc2/core/utils/map/region");
const buildWorkers = require("./build-workers");
const { MOVE, BUILD_REACTOR_STARPORT, LIFT } = require("@node-sc2/core/constants/ability");
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
const defenseSetup = require("../builds/defense-setup");
const { generalScouting } = require("../builds/scouting");
const { labelQueens, inject, spreadCreep, maintainQueens } = require("../builds/zerg/queen-management");
const { overlordCoverage } = require("../builds/zerg/overlord-management");
const { shadowEnemy } = require("../builds/helper");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior } = require("./unit-behavior");
const { salvageBunker } = require("../builds/terran/salvage-bunker");
const { harass } = require("../builds/harass");
const { expand } = require("./general-actions");
const { swapBuildings, checkAddOnPlacement } = require("../builds/terran/swap-buildings");
const { getCombatRally } = require("./location");
const { repairBurningStructures, repairDamagedMechUnits } = require("../builds/terran/repair");
const { getMineralFieldTarget } = require("../builds/terran/mineral-field");

let actions;
let opponentRace;
let race;
let ATTACKFOOD = 194;

class AssemblePlan {
  constructor(plan) {
    this.foundPosition = null;
    this.planOrder = plan.order;
    this.mainCombatTypes = plan.unitTypes.mainCombatTypes;
    this.defenseTypes = plan.unitTypes.defenseTypes;
    this.scoutTypes = plan.unitTypes.scoutTypes;
    this.defenseStructures = plan.unitTypes.defenseStructures;
    this.supportUnitTypes = plan.unitTypes.supportUnitTypes;
  }
  onEnemyFirstSeen(seenEnemyUnit) {
    opponentRace = seenEnemyUnit.data().race
  }
  onGameStart(world) {
    actions = world.resources.get().actions;
    race = world.agent.race;
    opponentRace = world.agent.opponent.race;
  }
  async onStep(world, state) {
    this.collectedActions = [];
    this.state = state;
    this.state.defenseStructures = this.defenseStructures;
    this.world = world;
    this.agent = world.agent;
    this.data = world.data;
    this.foodUsed = this.world.agent.foodUsed
    this.resources = world.resources;
    this.map = this.resources.get().map;
    this.units = this.resources.get().units;
    baseThreats(this.resources, this.state);
    await this.runPlan();
    if (this.foodUsed < ATTACKFOOD) {
      if (this.state.defenseMode) {
        this.collectedActions.push(...await defend(world, this.mainCombatTypes, this.supportUnitTypes));
      } else { this.collectedActions.push(...rallyUnits(this.resources, this.supportUnitTypes, this.state.defenseLocation)); }
    } else { this.collectedActions.push(...attack(this.resources, this.mainCombatTypes, this.supportUnitTypes)); }
    if (this.agent.minerals > 512) {
      balanceResources(world.agent, world.data, world.resources);
      this.manageSupply([this.foodUsed]);
      this.state.pauseBuilding = false;
    }
    if (this.foodUsed >= 132 && !shortOnWorkers(this.resources)) { this.collectedActions.push(...await expand(this.agent, this.data, this.resources, this.state)); }
    if (this.foodUsed >= ATTACKFOOD) {  }
    this.checkEnemyBuild();
    defenseSetup(world, this.state);
    let completedBases = this.units.getBases().filter(base => base.buildProgress >= 1);
    if (completedBases.length >= 3) {
      this.collectedActions.push(...salvageBunker(this.units));
      this.state.defendNatural = false;
    } else {
      this.state.defendNatural = true;
    }
    await this.raceSpecificManagement();
    this.collectedActions.push(...shadowEnemy(this.map, this.units, this.state, this.scoutTypes));
    this.collectedActions.push(...liberatorBehavior(this.resources));
    this.collectedActions.push(...marineBehavior(this.resources));
    this.collectedActions.push(...supplyDepotBehavior(this.resources));
    await actions.sendAction(this.collectedActions);
  }
  async ability(food, abilityId, conditions) {
    if (this.foodUsed >= food) {
      if (conditions === undefined || conditions.targetType || conditions.targetCount === this.units.getById(conditions.countType).length + this.units.withCurrentOrders(abilityId).length) {
        if (conditions && conditions.targetType && conditions.continuous === false) { if (this.foodUsed !== food) { return; } }
        let canDoTypes = this.data.findUnitTypesWithAbility(abilityId);
        if (canDoTypes.length === 0) {
          canDoTypes = this.units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
        }
        const unitsCanDo = this.units.getByType(canDoTypes).filter(units => units.abilityAvailable(abilityId));
        let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
        if (unitCanDo) {
          const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
          if (conditions && conditions.targetType) {
            let target;
            if (conditions.targetType === MINERALFIELD) {
              if ((conditions.controlled && this.agent.minerals <= 512) || !conditions.controlled) {
                target = getMineralFieldTarget(this.units, unitCanDo);
              }
            } else {
              const targets = this.units.getById(conditions.targetType).filter(unit => !unit.noQueue && unit.buffIds.indexOf(281) === -1);
              target = targets[Math.floor(Math.random() * targets.length)];
            }
            if (target) { unitCommand.targetUnitTag = target.tag; }
          }
          await actions.sendAction([unitCommand]);
          this.state.pauseBuilding = false;
        } else {
          if (conditions === undefined || conditions.targetType === undefined) {
            this.state.pauseBuilding = true;
            this.state.continueBuild = false;
          }
        }
      }
    }
  }
  async build(food, unitType, targetCount, candidatePositions=[]) {
    const placementConfig = placementConfigs[unitType];
    if (this.foodUsed >= food) {
      if (this.checkBuildingCount(targetCount, placementConfig)) {
        const toBuild = placementConfigs[unitType].toBuild;
        if (GasMineRace[race] === toBuild && this.agent.canAfford(toBuild)) {
          try {
            await actions.buildGasMine();
            this.state.pauseBuilding = false;
          }
          catch(error) {
            console.log(error);
            this.state.pauseBuilding = true;
            this.state.continueBuild = false;
          }
        }
        else if (TownhallRace[race].indexOf(toBuild) > -1 ) { this.collectedActions.push(...await expand(this.agent, this.data, this.resources, this.state)); } 
        else {
          if (candidatePositions.length === 0 ) { candidatePositions = this.findPlacements(placementConfig); }
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
        // this.collectedActions.push(...workerSendOrBuild(this.units, this.data.getUnitTypeData(placementConfig.toBuild).abilityId, this.foundPosition));
        await actions.sendAction(workerSendOrBuild(this.units, this.data.getUnitTypeData(placementConfig.toBuild).abilityId, this.foundPosition));
        this.state.pauseBuilding = false;
        this.state.continueBuild = false;
      } else {
        this.collectedActions.push(...workerSendOrBuild(this.units, MOVE, this.foundPosition));
        this.state.pauseBuilding = true;
        this.state.continueBuild = false;
      }
    } else {
      const [ pylon ] = this.units.getById(PYLON);
      if (pylon) {
        this.collectedActions.push(...workerSendOrBuild(this.units, MOVE, pylon.pos));
        this.state.pauseBuilding = true;
        this.state.continueBuild = false;
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
    // on first scout:
    if (frame.timeInSeconds() > 75 && frame.timeInSeconds() <= 90) {
      switch (race) {
        case Race.PROTOSS:
          // protoss: two gateways
        case Race.TERRAN:
          // terran: 1 barracks and 1 gas.
        case Race.ZERG:
          // zerg: natural before pool
      }
    }
    // if scouting probe and time is greater than 2 minutes. If no base, stay defensive.
    if (frame.timeInSeconds() > 132 && frame.timeInSeconds() <= 240) {
      if (this.map.getNatural().getBase() === undefined) {
        this.state.enemyBuildType = 'cheese';
      } else {
        this.state.enemyBuildType = 'standard';
      };
    } 
    if (frame.timeInSeconds() > 240) {
      this.state.enemyBuildType = 'complete';
    }
  }
  findPlacements(placementConfig) {
    const { map } = this.resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    let placements = [];
    if (race === Race.PROTOSS) {
      if (placementConfig.toBuild === PYLON) {
        const occupiedExpansions = getOccupiedExpansions(this.resources);
        const occupiedExpansionsPlacementGrid = [...occupiedExpansions.map(expansion => expansion.areas.placementGrid)];
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(...grid));
        // placements = [...main.areas.placementGrid, ...natural.areas.placementGrid, ...occupiedExpansions]
        placements = placementGrids
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
    // front of natural pylon for great justice
    const naturalWall = map.getNatural() ? map.getNatural().getWall() : null;
    let possiblePlacements = [];
    if (naturalWall) {
      possiblePlacements = frontOfGrid(this.world, map.getNatural().areas.areaFill)
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
          // TODO: remove third parameter and handle undefined in train function.
          case Race.TERRAN:
            await this.build(this.foodUsed, 'SUPPLYDEPOT', this.units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).length)
          case Race.PROTOSS:
            await this.build(this.foodUsed, 'PYLON', this.units.getById(PYLON).length);
            break;
          case Race.ZERG:
            let abilityId = this.data.getUnitTypeData(OVERLORD).abilityId;
            await this.train(this.foodUsed, OVERLORD, this.units.getById(OVERLORD).length + this.units.withCurrentOrders(abilityId).length);
            break;
        }
      }
    }
  }

  async onUnitCreated(world, createdUnit) {
    this.collectedActions && this.collectedActions.push(...generalScouting(world, createdUnit));
    await world.resources.get().actions.sendAction(this.collectedActions);
  }
  async raceSpecificManagement() {
    switch (race) {
      case Race.ZERG:
        labelQueens(this.units);
        this.collectedActions.push(...inject(this.units));
        this.collectedActions.push(...overlordCoverage(this.units));
        this.collectedActions.push(...await spreadCreep(this.resources, this.units));
        break;
      case Race.TERRAN:
        this.collectedActions.push(...repairBurningStructures(this.resources));
        this.collectedActions.push(...repairDamagedMechUnits(this.resources));
        break;
    }
  }
  scout(foodRanges, unitType, targetLocation, conditions) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      const label = 'scout';
      const labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length === 0) {
        if (conditions) {
          if (this.units.getByType(conditions.unitType).length === conditions.unitCount) {
            this.setScout(unitType, label, this.map[targetLocation]().townhallPosition);
          }
        } else {
          this.setScout(unitType, label, this.map[targetLocation]().townhallPosition);
        }
      }
      const [ scout ] = labelledScouts;
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
      let [ scout ] = this.units.getClosest(location, this.units.getById(unitType).filter(unit => unit.noQueue || unit.orders.findIndex(order => order.abilityId === 16) > -1));
      if (!scout) { [ scout ] = this.units.getClosest(location, this.units.getById(unitType).filter(unit => unit.unitType === unitType && !unit.isConstructing())) }
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
          const trainer = this.units.getProductionUnits(unitType).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
          if (trainer) {
            const unitCommand = {
              abilityId,
              unitTags: [ trainer.tag ],
            }
            // this.collectedActions.push(unitCommand);
            await actions.sendAction([unitCommand]);
          } else {
            abilityId = WarpUnitAbility[unitType]
            const warpGates = this.units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
            if (warpGates.length > 0) {
              try { await actions.warpIn(unitType, { nearPosition: getCombatRally(this.map, this.units) }) } catch (error) { console.log(error); }
            }
          }
          this.state.pauseBuilding = false;
        } else {
          this.state.pauseBuilding = true;
          this.state.continueBuild = false;
        }
      }
    }
  }
  async upgrade(food, upgradeId) {
    if (this.foodUsed >= food) {
      const upgraders = this.units.getUpgradeFacilities(upgradeId);
      const { abilityId } = this.data.getUpgradeData(upgradeId);
      const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
      if (!this.agent.upgradeIds.includes(upgradeId) && foundUpgradeInProgress === undefined) {
        const upgrader = this.units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
        if (upgrader) {
          const unitCommand = { abilityId, unitTags: [upgrader.tag] };
          await actions.sendAction([unitCommand]);
          this.state.pauseBuilding = false;
        } else {
          this.state.pauseBuilding = true;
          this.state.continueBuild = false;
        }
      }
    }
  }
  
  async runPlan() {
    this.state.continueBuild = true;
    for (let step = 0; step < this.planOrder.length; step++) {
      if (this.state.continueBuild) {
        const planStep = this.planOrder[step];
        let targetCount = planStep[3];
        const foodTarget = planStep[0];
        let conditions;
        let unitType;
        switch (planStep[1]) {
          case 'ability':
            const abilityId = planStep[2];
            conditions = planStep[3];
            await this.ability(foodTarget, abilityId, conditions);
            break;
          case 'build':
            unitType = planStep[2];
            await this.build(foodTarget, unitType, targetCount, planStep[4] ? this[planStep[4]]() : []);
            break;
          case 'buildWorkers': if (!this.state.pauseBuilding) { await this.buildWorkers(planStep[0], planStep[2] ? planStep[2] : null); } break;
          case 'continuouslyBuild':
            const foodRanges = planStep[0];
            if (this.agent.minerals > 512 && foodRanges.indexOf(this.foodUsed) > -1) { await continuouslyBuild(this.agent, this.data, this.resources, planStep[2], planStep[3]); } break;
          case 'harass': if (this.state.enemyBuildType === 'standard') { harass(this.resources, this.state); } break;
          case 'maintainQueens': if (this.foodUsed >= foodTarget) { await maintainQueens(this.resources, this.data, this.agent); } break;
          case 'manageSupply': await this.manageSupply(planStep[0]); break;
          case 'scout':
            unitType = planStep[2];
            const targetLocation = planStep[3];
            conditions = planStep[4];
            this.scout(foodTarget, unitType, targetLocation, conditions );
            break;
          case 'train':
            unitType = planStep[2];
            try { await this.train(foodTarget, unitType, targetCount); } catch(error) { console.log(error) } break;
          case 'swapBuildings':
            conditions = planStep[2];
            if (this.foodUsed >= foodTarget) { swapBuildings(this.resources, conditions); }
            break;
          case 'upgrade':
            const upgradeId = planStep[2];
            this.upgrade(foodTarget, upgradeId);
            break;
        }
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