//@ts-check
"use strict"

const { PYLON, WARPGATE, OVERLORD, SUPPLYDEPOT, SUPPLYDEPOTLOWERED, MINERALFIELD, STARPORTREACTOR, BARRACKS, SPAWNINGPOOL, GATEWAY, ZERGLING } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions } = require("./expansions");
const placementConfigs = require("./placement-configs");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { frontOfGrid } = require("@node-sc2/core/utils/map/region");
const buildWorkers = require("./build-workers");
const { MOVE, BUILD_REACTOR_STARPORT } = require("@node-sc2/core/constants/ability");
const canAfford = require("./can-afford");
const isSupplyNeeded = require("./supply");
const rallyUnits = require("./rally-units");
const { workerSendOrBuild, getSupply, getTrainingSupply } = require("../helper");
const shortOnWorkers = require("./short-on-workers");
const { WarpUnitAbility } = require("@node-sc2/core/constants");
const continuouslyBuild = require("./continuously-build");
const { gasMineCheckAndBuild } = require("./balance-resources");
const { TownhallRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const { defend, attack } = require("./army-behavior");
const baseThreats = require("./base-threats");
const { generalScouting } = require("../builds/scouting");
const { labelQueens, inject, spreadCreep, maintainQueens } = require("../builds/zerg/queen-management");
const { overlordCoverage } = require("../builds/zerg/overlord-management");
const { shadowEnemy } = require("../builds/helper");
const { liberatorBehavior, marineBehavior, supplyDepotBehavior, workerBehavior, scoutMainBehavior } = require("./unit-behavior");
const { salvageBunker } = require("../builds/terran/salvage-bunker");
const { expand } = require("./general-actions");
const { swapBuildings, checkAddOnPlacement } = require("../builds/terran/swap-buildings");
const { getCombatRally } = require("./location");
const { repairBurningStructures, repairDamagedMechUnits, repairBunker, finishAbandonedStructures } = require("../builds/terran/repair");
const { getMineralFieldTarget } = require("../builds/terran/mineral-field");
const { harass } = require("../builds/harass");
const { getBetweenBaseAndWall } = require("./placement-helper");
const { restorePower } = require("./protoss");

let actions;
let opponentRace;
let race;
let ATTACKFOOD = 194;

class AssemblePlan {
  constructor(plan) {
    this.collectedActions = [];
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
    this.frame = this.resources.get().frame;
    this.map = this.resources.get().map;
    this.units = this.resources.get().units;
    this.threats = baseThreats(this.resources, this.state);
    this.enemySupply = getSupply(this.units.getCombatUnits(Alliance.ENEMY), this.data);
    this.selfSupply = getSupply(this.units.getCombatUnits(), this.data) + getTrainingSupply(this.defenseTypes, this.data, this.units);
    this.outSupplied = this.enemySupply > this.selfSupply;
    if (this.outSupplied) {
      console.log('Scouted higher supply', this.selfSupply, this.enemySupply);
      console.log(this.frame.timeInSeconds());
      await continuouslyBuild(this.world, this.defenseTypes); 
    }
    await this.runPlan();
    if (this.foodUsed < ATTACKFOOD && this.state.pushMode === false) {
      if (this.state.defenseMode) {
        this.collectedActions.push(...await defend(world, this.mainCombatTypes, this.supportUnitTypes, this.threats));
      } else { this.collectedActions.push(...rallyUnits(world, this.supportUnitTypes, this.state.defenseLocation)); }
    } else { this.collectedActions.push(...attack(this.world, this.mainCombatTypes, this.supportUnitTypes)); }
    if (this.agent.minerals > 512) {
      gasMineCheckAndBuild(world);
      this.manageSupply();
      this.state.pauseBuilding = false;
    }
    if (this.foodUsed >= 132 && !shortOnWorkers(this.resources)) { this.collectedActions.push(...await expand(this.agent, this.data, this.resources, this.state)); }
    if (this.foodUsed >= ATTACKFOOD) {  }
    this.checkEnemyBuild();
    let completedBases = this.units.getBases().filter(base => base.buildProgress >= 1);
    if (completedBases.length >= 3) {
      this.collectedActions.push(...salvageBunker(this.units));
      this.state.defendNatural = false;
      this.state.enemyBuildType = 'midgame';
    } else {
      this.state.defendNatural = true;
    }
    await this.raceSpecificManagement();
    this.collectedActions.push(...shadowEnemy(this.resources, this.state, this.scoutTypes));
    this.collectedActions.push(...liberatorBehavior(this.resources));
    this.collectedActions.push(...marineBehavior(this.resources));
    this.collectedActions.push(...scoutMainBehavior(this.resources));
    this.collectedActions.push(...supplyDepotBehavior(this.resources));
    this.collectedActions.push(...workerBehavior(world));
    if (this.frame.getGameLoop() % 8 === 0) {
      this.units.getAlive().forEach(unit => delete unit.expansions);
    }
    await actions.sendAction(this.collectedActions);
  }

  async onUnitDestroyed(destroyedUnit) {
    if (destroyedUnit.isWorker()) {
      this.state.pauseBuilding = false;
    }
  }
  
  async ability(food, abilityId, conditions) {
    if (this.foodUsed >= food) {
      if (conditions === undefined || conditions.targetType || conditions.targetCount === this.units.getById(conditions.countType).length + this.units.withCurrentOrders(abilityId).length) {
        if (conditions && conditions.targetType && conditions.continuous === false) { if (this.foodUsed !== food) { return; } }
        let canDoTypes = this.data.findUnitTypesWithAbility(abilityId);
        if (canDoTypes.length === 0) {
          canDoTypes = this.units.getAlive(Alliance.SELF).filter(unit => unit.abilityAvailable(abilityId)).map(canDoUnit => canDoUnit.unitType);
        }
        const unitsCanDo = this.units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
        if (unitsCanDo.length > 0) {
          let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
          const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
          if (conditions && conditions.targetType) {
            let target;
            if (conditions.targetType === MINERALFIELD) {
              if ((conditions.controlled && this.agent.minerals <= 512) || !conditions.controlled) {
                target = getMineralFieldTarget(this.units, unitCanDo);
              } else { return; }
            } else {
              const targets = this.units.getById(conditions.targetType).filter(unit => !unit.noQueue && unit.buffIds.indexOf(281) === -1);
              target = targets[Math.floor(Math.random() * targets.length)];
            }
            if (target) { unitCommand.targetUnitTag = target.tag; }
          }
          if (abilityId === 488 && !unitCanDo.isFlying) {
            const addOnTarget = {x: unitCanDo.pos.x + 2.5, y: unitCanDo.pos.y - 0.5};
            const canPlace = await actions.canPlace(STARPORTREACTOR, [ addOnTarget ]);
            if (!canPlace) {
              const foundPosition = await checkAddOnPlacement(this.world, unitCanDo, STARPORTREACTOR)
              if (foundPosition) { unitCommand.targetWorldSpacePos = foundPosition; } else { return; }
            }
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
        switch (true) {
          case GasMineRace[race] === toBuild && this.agent.canAfford(toBuild):
            try {
            if (this.map.freeGasGeysers().length > 0) {
              await actions.buildGasMine();
              this.state.pauseBuilding = false;
            }
          }
          catch(error) {
            console.log(error);
            this.state.pauseBuilding = true;
            this.state.continueBuild = false;
          }
            break;
          case TownhallRace[race].indexOf(toBuild) > -1:
            { this.collectedActions.push(...await expand(this.agent, this.data, this.resources, this.state)); } 
            break;
          case PHOTONCANNON === toBuild:
            candidatePositions = this.map.getNatural().areas.placementGrid;
          default:
            if (candidatePositions.length === 0 ) { candidatePositions = this.findPlacements(placementConfig); }
            await this.buildBuilding(placementConfig, candidatePositions);
        }
      }
    }
  }
  async buildWorkers(foodRanges, controlled=false) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (controlled) {
        if (!this.outSupplied && this.agent.minerals < 512 && shortOnWorkers(this.resources)) {
          try { await buildWorkers(this.agent, this.data, this.world.resources); } catch(error) { console.log(error); }
        }
      } else {
        try { await buildWorkers(this.agent, this.data, this.world.resources); } catch(error) { console.log(error); }
      }
    }
  }
  async buildBuilding(placementConfig, candidatePositions) {
    // find placement on main
    this.foundPosition = this.foundPosition ? this.foundPosition : await this.findPosition(actions, placementConfig.placement, candidatePositions);
    if (this.foundPosition) {
      if (this.agent.canAfford(placementConfig.toBuild)) {
        await actions.sendAction(workerSendOrBuild(this.units, this.data.getUnitTypeData(placementConfig.toBuild).abilityId, this.foundPosition));
        this.state.pauseBuilding = false;
        this.state.continueBuild = false;
        this.foundPosition = null;
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
    const { frame } = this.resources.get();
    // on first scout:
    if (frame.timeInSeconds() > 51 && frame.timeInSeconds() <= 120) {
      this.earlyScoutActive = true;
      console.log(frame.timeInSeconds());
      let conditions = [];
      switch (opponentRace) {
        case Race.PROTOSS:
          // protoss: two gateways
          conditions = [
            this.units.getById(GATEWAY, Alliance.ENEMY).length === 2,
          ];
          if (!conditions.every(c => c)) {
            if (this.state.enemyBuildType === 'standard') { console.log('cheese detected'); }
            this.state.enemyBuildType = 'cheese';
          }
          break;
        case Race.TERRAN:
          // scout alive, more than 1 barracks.
          const moreThanOneBarracks = this.units.getById(BARRACKS, Alliance.ENEMY).length > 1;
          if (this.state.enemyBuildType !== 'cheese') {
            if (moreThanOneBarracks) {
              console.log('More than one barracks');
              this.state.enemyBuildType = 'cheese';
            }
          }
          // 1 barracks and 1 gas, second command center
          conditions = [
            this.units.getById(BARRACKS, Alliance.ENEMY).length === 1,
            this.units.getById(GasMineRace[opponentRace], Alliance.ENEMY).length === 1,
            !!this.map.getEnemyNatural().getBase()
          ];
          if (!conditions.every(c => c)) {
            this.state.enemyBuildType = 'cheese';
          } else {
            this.state.enemyBuildType = 'standard';
          }
          this.scoutReport = `Barracks Count: ${this.units.getById(BARRACKS, Alliance.ENEMY).length}.
          Gas Mine Count: ${this.units.getById(GasMineRace[opponentRace], Alliance.ENEMY).length}.
          Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}.`;
          break;
        case Race.ZERG:
          // zerg: natural before pool
          const spawningPoolDetected = this.units.getById(SPAWNINGPOOL, Alliance.ENEMY).length > 0 || this.units.getById(ZERGLING, Alliance.ENEMY).length > 0;
          const enemyNaturalDetected = this.map.getEnemyNatural().getBase();
          if (this.state.enemyBuildType !== 'cheese') {
            if (spawningPoolDetected && !enemyNaturalDetected) {
              console.log('Pool before natural. Cheese detected');
              this.state.enemyBuildType = 'cheese';
              console.log('Spawning Pool Count:', this.units.getById(SPAWNINGPOOL, Alliance.ENEMY).length);
              console.log('Zergling Count:', this.units.getById(ZERGLING, Alliance.ENEMY).length);
              console.log('Enemy Natural detected', !!this.map.getEnemyNatural().getBase());
            }
            if (!enemyNaturalDetected && !!this.map.getNatural().getBase()) {
              console.log('Enemy expanding slower. Cheese detected');
              this.state.enemyBuildType = 'cheese';
            }
          }
          break;
      }
    } else {
      if (this.scoutReport) {
        console.log(this.scoutReport);
        this.scoutReport = '';
      }
      this.earlyScoutActive = false;
    }
    // if scouting probe and time is greater than 2 minutes. If no base, stay defensive.
    // if (frame.timeInSeconds() > 132 && frame.timeInSeconds() <= 240) {
    //   if (this.map.getEnemyNatural().getBase() === undefined) {
    //     this.state.enemyBuildType = 'cheese';
    //   } else {
    //     this.state.enemyBuildType = 'standard';
    //   };
    // } 
    // if (frame.timeInSeconds() > 240) {
    //   this.state.enemyBuildType = 'complete';
    // }
  }
  findPlacements(placementConfig) {
    const { map, units } = this.resources.get();
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
            (distance(natural.townhallPosition, point) > 5) &&
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
            (this.units.getStructures({ alliance: Alliance.SELF }).map(u => u.pos).every(eb => distance(eb, point) > 3)) &&
            (distance(point, units.getClosest(point, units.getStructures({ alliance: Alliance.SELF }))[0].pos) <= 12.5)
          );
        });
    }
    return placements;
  }

  findMineralLines() {
    const occupiedExpansions = this.map.getOccupiedExpansions();
    const mineralLineCandidates = [];
    occupiedExpansions.forEach(expansion => mineralLineCandidates.push(...gridsInCircle(avgPoints(expansion.areas.mineralLine), 1)));
    return mineralLineCandidates;
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
  async getBetweenBaseAndWall() {
    return await getBetweenBaseAndWall(this.resources, this.unitType)
  };
  async manageSupply(foodRanges) {
    if (!foodRanges || foodRanges.indexOf(this.foodUsed) > -1) {
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
    await generalScouting(world, createdUnit);
    await world.resources.get().actions.sendAction(this.collectedActions);
  }
  async raceSpecificManagement() {
    switch (race) {
      case Race.ZERG:
        labelQueens(this.units);
        this.collectedActions.push(...inject(this.units));
        this.collectedActions.push(...overlordCoverage(this.units));
        this.collectedActions.push(...await spreadCreep(this.resources));
        break;
      case Race.TERRAN:
        this.collectedActions.push(...repairBurningStructures(this.resources));
        this.collectedActions.push(...repairDamagedMechUnits(this.resources));
        this.collectedActions.push(...repairBunker(this.resources));
        this.collectedActions.push(...finishAbandonedStructures(this.resources));
        break;
      case Race.PROTOSS:
        this.collectedActions.push(...restorePower(this.world));
        break;
    }
  }
  push(foodRanges) {
    const label = 'pusher';
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (this.state.pushMode === false && !this.state.cancelPush) {
        [...this.mainCombatTypes, ...this.supportUnitTypes].forEach(type => {
          this.units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')).forEach(unit => unit.labels.set(label, true));
        });
        console.log('getSupply(this.units.withLabel(label), this.data)', getSupply(this.units.withLabel(label), this.data));
        this.state.pushMode = true;
      }
    }
    if (this.units.withLabel(label).length > 0 && !this.state.cancelPush) {
      if (this.outSupplied) {
        this.state.cancelPush = true;
        console.log('cancelPush');
      } else {
        this.collectedActions.push(...attack(this.world, this.mainCombatTypes, this.supportUnitTypes));
      }
    } else if (this.state.pushMode === true) {
      this.state.pushMode = false;
      this.state.cancelPush = true;
      console.log('cancelPush');
    }
  }
  scout(foodRanges, unitType, targetLocationFunction, conditions) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      const targetLocation = (this.map[targetLocationFunction] && this.map[targetLocationFunction]()) ? this.map[targetLocationFunction]().townhallPosition : locationHelper[targetLocationFunction](this.map);
      const label = conditions && conditions.label ? conditions.label: 'scout';
      const labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length === 0) {
        if (conditions && conditions.unitType) {
          if (this.units.getByType(conditions.unitType).length === conditions.unitCount) {
            this.setScout(unitType, label, targetLocation);
          }
        } else {
          this.setScout(unitType, label, targetLocation);
        }
      }
      const [ scout ] = labelledScouts;
      if (scout) { 
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: targetLocation,
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
          const trainer = this.units.getProductionUnits(unitType).find(unit => (unit.noQueue || (unit.hasReactor() && unit.orders.length < 2)) && unit.abilityAvailable(abilityId));
          if (trainer) {
            const unitCommand = {
              abilityId,
              unitTags: [ trainer.tag ],
            }
            await actions.sendAction([unitCommand]);
          } else {
            abilityId = WarpUnitAbility[unitType]
            const warpGates = this.units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
            if (warpGates.length > 0) {
              try { await actions.warpIn(unitType, { nearPosition: getCombatRally(this.map, this.units) }) } catch (error) { console.log(error); }
            } else {
              this.state.pauseBuilding = true;
              return;
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
            this.unitType = placementConfigs[unitType].toBuild;
            const enemyBuild = planStep[5];
            if (enemyBuild && this.state.enemyBuildType !== enemyBuild && !this.earlyScoutActive) { break; }
            await this.build(foodTarget, unitType, targetCount, planStep[4] ? await this[planStep[4]]() : []);
            break;
          case 'buildWorkers': if (!this.state.pauseBuilding) { await this.buildWorkers(planStep[0], planStep[2] ? planStep[2] : null); } break;
          case 'continuouslyBuild':
            const foodRanges = planStep[0];
            if (this.agent.minerals > 512 && foodRanges.indexOf(this.foodUsed) > -1) { await continuouslyBuild(this.world, planStep[2], planStep[3]); } break;
          case 'harass': if (this.state.enemyBuildType === 'standard') { await harass(this.resources, this.state); } break;
          case 'maintainQueens': if (this.foodUsed >= foodTarget) { await maintainQueens(this.resources, this.data, this.agent); } break;
          case 'manageSupply': await this.manageSupply(planStep[0]); break;
          case 'push': this.push(foodTarget); break;
          case 'scout':
            unitType = planStep[2];
            const targetLocationFunction = planStep[3];
            conditions = planStep[4];
            if (targetLocationFunction.includes('get')) {
              const label = targetLocationFunction.replace('get', 'scout')
              if (!conditions) {
                conditions = {};
              }
              conditions.label = label;
            }
            this.scout(foodTarget, unitType, targetLocationFunction, conditions );
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