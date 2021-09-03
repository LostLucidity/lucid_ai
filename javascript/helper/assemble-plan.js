//@ts-check
"use strict"

const { PYLON, WARPGATE, OVERLORD, SUPPLYDEPOT, SUPPLYDEPOTLOWERED, MINERALFIELD, BARRACKS, SPAWNINGPOOL, GATEWAY, ZERGLING, PHOTONCANNON, PROBE } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getOccupiedExpansions } = require("./expansions");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { frontOfGrid } = require("@node-sc2/core/utils/map/region");
const buildWorkers = require("./build-workers");
const { MOVE } = require("@node-sc2/core/constants/ability");
const canBuild = require("./can-afford");
const isSupplyNeeded = require("./supply");
const rallyUnits = require("./rally-units");
const { workerSendOrBuild, getSupply, getTrainingSupply, checkBuildingCount, setPendingOrders } = require("../helper");
const shortOnWorkers = require("./short-on-workers");
const { WarpUnitAbility, UnitType, Upgrade } = require("@node-sc2/core/constants");
const continuouslyBuild = require("./continuously-build");
const { TownhallRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const { defend, attack, push } = require("./behavior/army-behavior");
const threats = require("./base-threats");
const { generalScouting } = require("../builds/scouting");
const { labelQueens, inject, spreadCreep, maintainQueens } = require("../builds/zerg/queen-management");
const { overlordCoverage } = require("../builds/zerg/overlord-management");
const { moveAway } = require("../builds/helper");
const { salvageBunker } = require("../builds/terran/salvage-bunker");
const { expand } = require("./general-actions");
const { repairBurningStructures, repairDamagedMechUnits, repairBunker, finishAbandonedStructures } = require("../builds/terran/repair");
const { getMineralFieldTarget } = require("../builds/terran/mineral-field");
const { harass } = require("../builds/harass");
const { getBetweenBaseAndWall, findPosition, inTheMain } = require("./placement/placement-helper");
const locationHelper = require("./location");
const { restorePower, warpIn } = require("./protoss");
const { liftToThird, addAddOn, swapBuildings } = require("./terran");
const { balanceResources } = require("../systems/manage-resources");
const { addonTypes } = require("@node-sc2/core/constants/groups");
const { getClosestPosition } = require("./get-closest");
const runBehaviors = require("./behavior/run-behaviors");
const { workersTrainingTendedTo, haveAvailableProductionUnitsFor } = require("../systems/unit-training/unit-training-service");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { checkUnitCount } = require("../systems/track-units/track-units-service");
const mismatchMappings = require("../systems/salt-converter/mismatch-mapping");
const { getStringNameOfConstant } = require("../services/logging-service");
const { getBuildingFootprintOfOrphanAddons, keepPosition } = require("../services/placement-service");
const { getEnemyWorkers } = require("../services/units-service");

let actions;
let opponentRace;
let race;
let ATTACKFOOD = 194;

class AssemblePlan {
  constructor(plan) {
    this.collectedActions = [];
    this.foundPosition = null;
    this.planOrders = plan.orders;
    this.mainCombatTypes = plan.unitTypes.mainCombatTypes;
    this.defenseTypes = plan.unitTypes.defenseTypes;
    this.defenseStructures = plan.unitTypes.defenseStructures;
    this.supportUnitTypes = plan.unitTypes.supportUnitTypes;
  }
  onEnemyFirstSeen(seenEnemyUnit) {
    opponentRace = seenEnemyUnit.data().race;
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
    if (this.foodUsed > this.world.agent.foodUsed) {
      this.state.pauseBuilding = false;
    }
    this.foodUsed = this.world.agent.foodUsed;
    this.resources = world.resources;
    this.frame = this.resources.get().frame;
    this.map = this.resources.get().map;
    this.units = this.resources.get().units;
    this.resourceTrigger = this.agent.minerals > 512 && this.agent.vespene > 256;
    this.threats = threats(this.resources, this.state);
    this.enemySupply = enemyTrackingService.getEnemyCombatSupply(this.data);
    const inFieldSelfSupply = getSupply(this.data, this.units.getCombatUnits());
    this.selfSupply = inFieldSelfSupply + getTrainingSupply(world, this.defenseTypes);
    this.outSupplied = this.enemySupply > this.selfSupply;
    const trainUnitConditions = [
      this.outSupplied,
      workersTrainingTendedTo(world) && !this.state.pauseBuilding,
      !shortOnWorkers(this.resources) && !this.state.pauseBuilding,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      this.outSupplied ? console.log(this.frame.timeInSeconds(), 'Scouted higher supply', this.selfSupply, this.enemySupply) : console.log(this.frame.timeInSeconds(), 'Free build mode.');
      const haveProductionAndTechForTypes = this.defenseTypes.filter(type => haveAvailableProductionUnitsFor(world, type) && this.agent.hasTechFor(type));
      if (haveProductionAndTechForTypes.length > 0) {
        this.selectedTypeToBuild = this.selectedTypeToBuild ? this.selectedTypeToBuild : haveProductionAndTechForTypes[Math.floor(Math.random() * haveProductionAndTechForTypes.length)];
        let { mineralCost, vespeneCost } = this.data.getUnitTypeData(this.selectedTypeToBuild);
        if (this.agent.minerals >= (mineralCost * 2) && this.agent.vespene >= (vespeneCost * 2)) {
          await this.train(this.foodUsed, this.selectedTypeToBuild, null);
        }
      }
    }
    await this.runPlan();
    if (this.foodUsed < ATTACKFOOD) {
      if (!this.state.pushMode) {
        if (this.state.defenseMode) {
          this.collectedActions.push(...await defend(world, this, this.mainCombatTypes, this.supportUnitTypes, this.threats));
        } else {
          this.collectedActions.push(...rallyUnits(world, this.supportUnitTypes, this.state.defenseLocation));
        }
      }
    } else {
      if (!this.outSupplied || this.selfSupply === inFieldSelfSupply) { this.collectedActions.push(...attack(this.world, this.mainCombatTypes, this.supportUnitTypes)); }
    }
    if (this.agent.minerals > 512) { this.manageSupply(); }
    if (this.foodUsed >= 132 && !shortOnWorkers(this.resources)) { this.collectedActions.push(...await expand(world, this.state)); }
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
    this.collectedActions.push(...await runBehaviors(world, opponentRace));
    if (this.frame.getGameLoop() % 8 === 0) {
      this.units.getAlive().forEach(unit => delete unit.expansions);
    }
    const label = 'pendingOrders';
    this.units.withLabel(label).forEach(unit => unit.labels.delete(label));
    await actions.sendAction(this.collectedActions);
  }

  async onUnitDamaged(resources, damagedUnit) {
    const { units } = resources.get();
    if (damagedUnit.labels.get('scoutEnemyMain') || damagedUnit.labels.get('scoutEnemyNatural')) {
      const [closestEnemyUnit] = units.getClosest(damagedUnit.pos, enemyTrackingService.enemyUnits);
      await actions.sendAction(moveAway(damagedUnit, closestEnemyUnit, 4));
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
            else { return; }
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
  async build(food, unitType, targetCount, candidatePositions = []) {
    if (this.foodUsed >= food) {
      if (checkBuildingCount(this.world, unitType, targetCount)) {
        switch (true) {
          case GasMineRace[race] === unitType:
            try {
              if (this.map.freeGasGeysers().length > 0) {
                if (this.agent.canAfford(unitType)) {
                  await actions.buildGasMine();
                  this.state.pauseBuilding = false;
                } else {
                  this.collectedActions.push(...workerSendOrBuild(this.resources, MOVE, this.map.freeGasGeysers()[0].pos));
                  const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
                  await balanceResources(this.world, mineralCost / vespeneCost);
                  this.state.pauseBuilding = true;
                  this.state.continueBuild = false;
                }

              }
            }
            catch (error) {
              console.log(error);
              this.state.pauseBuilding = true;
              this.state.continueBuild = false;
            }
            break;
          case TownhallRace[race].indexOf(unitType) > -1 && candidatePositions.length === 0:
            { this.collectedActions.push(...await expand(this.world, this.state)); }
            break;
          case addonTypes.includes(unitType):
            let abilityId = this.data.getUnitTypeData(unitType).abilityId;
            let canDoTypes = this.data.findUnitTypesWithAbility(abilityId);
            const addOnUnits = this.units.withLabel('addAddOn').filter(addOnUnit => {
              const addOnPosition = addOnUnit.labels.get('addAddOn');
              if (addOnPosition && distance(addOnUnit.pos, addOnPosition) < 1) { addOnUnit.labels.delete('addAddOn'); }
              else { return true; }
            });
            const unitsCanDo = addOnUnits.length > 0 ? addOnUnits : this.units.getByType(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
            if (unitsCanDo.length > 0) {
              let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
              await addAddOn(this.world, unitCanDo, abilityId, unitType)
            } else {
              const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
              await balanceResources(this.world, mineralCost / vespeneCost);
              this.state.pauseBuilding = true;
              this.state.continueBuild = false;
            }
            break;
          case PHOTONCANNON === unitType:
            candidatePositions = this.map.getNatural().areas.placementGrid;
          default:
            if (candidatePositions.length === 0) { candidatePositions = this.findPlacements(unitType); }
            await this.buildBuilding(unitType, candidatePositions);
        }
      }
    }
  }
  async buildWorkers(foodRanges, controlled = false) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (controlled) {
        if (!this.outSupplied && (this.units.getBases().length <= 2 || !this.resourceTrigger) && shortOnWorkers(this.resources)) {
          try { await buildWorkers(this.agent, this.data, this.world.resources); } catch (error) { console.log(error); }
        }
      } else {
        try { await buildWorkers(this.agent, this.data, this.world.resources); } catch (error) { console.log(error); }
      }
    }
  }
  async buildBuilding(unitType, candidatePositions) {
    this.foundPosition = this.foundPosition ? this.foundPosition : await findPosition(this.resources, unitType, candidatePositions);
    if (this.foundPosition) {
      if (this.agent.canAfford(unitType)) {
        if (await actions.canPlace(unitType, [this.foundPosition])) {
          await actions.sendAction(workerSendOrBuild(this.resources, this.data.getUnitTypeData(unitType).abilityId, this.foundPosition));
          this.state.pauseBuilding = false;
          this.state.continueBuild = false;
          this.foundPosition = null;
        } else {
          this.foundPosition = keepPosition(this.resources, unitType, this.foundPosition) ? this.foundPosition : null;
          if (this.foundPosition) { this.collectedActions.push(...workerSendOrBuild(this.resources, MOVE, this.foundPosition)); }
          this.state.pauseBuilding = true;
          this.state.continueBuild = false;
        }
      } else {
        this.collectedActions.push(...workerSendOrBuild(this.resources, MOVE, this.foundPosition));
        const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
        await balanceResources(this.world, mineralCost / vespeneCost);
        this.state.pauseBuilding = true;
        this.state.continueBuild = false;
      }
    }
  }
  checkEnemyBuild() {
    const { frame } = this.resources.get();
    if (frame.timeInSeconds() > 122) { this.earlyScout = false }
    if (this.earlyScout) {
      const suspiciousWorkerCount = getEnemyWorkers(this.world).filter(worker => distance(worker.pos, this.map.getEnemyMain().townhallPosition) > 16).length;
      if (suspiciousWorkerCount > 2) {
        this.state.enemyBuildType = 'cheese';
        this.scoutReport = `${this.state.enemyBuildType} detected:
          Work Rush Detected: ${suspiciousWorkerCount} sus workers.`;
        this.earlyScout = false;
        return;
      }
      let conditions = [];
      switch (opponentRace) {
        case Race.PROTOSS:
          const moreThanTwoGateways = this.units.getById(GATEWAY, Alliance.ENEMY).length > 2;
          if (moreThanTwoGateways) {
            console.log(frame.timeInSeconds(), 'More than two gateways');
            this.state.enemyBuildType = 'cheese';
            this.earlyScout = false;
          }
          conditions = [
            this.units.getById(GATEWAY, Alliance.ENEMY).length === 2,
          ];
          if (!conditions.every(c => c)) {
            this.state.enemyBuildType = 'cheese';
          } else {
            this.state.enemyBuildType = 'standard';
          }
          this.scoutReport = `${this.state.enemyBuildType} detected:
          Gateway Count: ${this.units.getById(GATEWAY, Alliance.ENEMY).length}.`;
          break;
        case Race.TERRAN:
          // scout alive, more than 1 barracks.
          const moreThanOneBarracks = this.units.getById(BARRACKS, Alliance.ENEMY).length > 1;
          if (this.state.enemyBuildType !== 'cheese') {
            if (moreThanOneBarracks) {
              console.log(frame.timeInSeconds(), 'More than one barracks');
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
          this.scoutReport = `${this.state.enemyBuildType} detected:
          Barracks Count: ${this.units.getById(BARRACKS, Alliance.ENEMY).length}.
          Gas Mine Count: ${this.units.getById(GasMineRace[opponentRace], Alliance.ENEMY).length}.
          Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}.`;
          break;
        case Race.ZERG:
          const spawningPoolDetected = this.units.getById(SPAWNINGPOOL, Alliance.ENEMY).length > 0 || this.units.getById(ZERGLING, Alliance.ENEMY).length > 0;
          const enemyNaturalDetected = this.map.getEnemyNatural().getBase();
          if (this.state.enemyBuildType !== 'cheese') {
            if (spawningPoolDetected && !enemyNaturalDetected) {
              console.log(frame.timeInSeconds(), 'Pool first. Cheese detected');
              this.state.enemyBuildType = 'cheese';
              this.scoutReport = `${this.state.enemyBuildType} detected:
              Spawning Pool: ${this.units.getById(SPAWNINGPOOL, Alliance.ENEMY).length > 0}.
              Zerglings: ${this.units.getById(ZERGLING, Alliance.ENEMY).length > 0}
              Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}`;
              this.earlyScout = false;
            } else if (!spawningPoolDetected && enemyNaturalDetected) {
              console.log(frame.timeInSeconds(), 'Hatchery first. Standard.');
              this.state.enemyBuildType = 'standard';
              this.scoutReport = `${this.state.enemyBuildType} detected:
              Spawning Pool: ${this.units.getById(SPAWNINGPOOL, Alliance.ENEMY).length > 0}.
              Zerglings: ${this.units.getById(ZERGLING, Alliance.ENEMY).length > 0}
              Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}`;
              this.earlyScout = false;
            }
            if (!enemyNaturalDetected && !!this.map.getNatural().getBase()) {
              console.log(frame.timeInSeconds(), 'Enemy expanding slower. Cheese detected');
              this.state.enemyBuildType = 'cheese';
              this.scoutReport = `Enemy expanding slower. Cheese detected`;
              this.earlyScout = false;
            }
          }
          break;
      }
    } else {
      if (this.scoutReport) {
        console.log(this.scoutReport);
        this.scoutReport = '';
        const earlyScouts = this.units.getAlive(Alliance.SELF).filter(unit => {
          return unit.labels.has('scoutEnemyMain') || unit.labels.has('scoutEnemyNatural');
        });
        if (earlyScouts.length > 0) {
          earlyScouts.forEach(earlyScout => {
            earlyScout.labels.clear();
            earlyScout.labels.set('clearFromEnemy', true);
          });
        }
      }
    }
  }
  findPlacements(unitType) {
    const { map, units } = this.resources.get();
    const [main, natural] = map.getExpansions();
    const mainMineralLine = main.areas.mineralLine;
    let placements = [];
    if (race === Race.PROTOSS) {
      if (unitType === PYLON) {
        const occupiedExpansions = getOccupiedExpansions(this.resources);
        const occupiedExpansionsPlacementGrid = [...occupiedExpansions.map(expansion => expansion.areas.placementGrid)];
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(...grid));
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
        .filter(point => getBuildingFootprintOfOrphanAddons(units).every(pos => distance(pos, point) > 3))
        .map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements = map.getCreep()
        .filter((point) => {
          const [closestMineralLine] = getClosestPosition(point, mainMineralLine);
          const [closestStructure] = units.getClosest(point, units.getStructures());
          const [closestTownhallPosition] = getClosestPosition(point, map.getExpansions().map(expansion => expansion.townhallPosition));
          return (
            distance(point, closestMineralLine) > 1.5 &&
            distance(point, closestStructure.pos) > 3 &&
            distance(point, closestStructure.pos) <= 12.5 &&
            distance(point, closestTownhallPosition) > 3
          );
        });
    }
    return placements;
  }

  findMineralLines() {
    const occupiedExpansions = this.map.getOccupiedExpansions()
    const mineralLineCandidates = [];
    occupiedExpansions.forEach(expansion => {
      const [base] = this.units.getClosest(expansion.townhallPosition, this.units.getBases());
      if (base) {
        mineralLineCandidates.push(...gridsInCircle(avgPoints([...expansion.cluster.mineralFields.map(field => field.pos), base.pos, base.pos]), 0.6))
      }
    });
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
  async getBetweenBaseAndWall(unitType) {
    return await getBetweenBaseAndWall(this.resources, unitType);
  };

  async inTheMain(unitType) {
    return await inTheMain(this.resources, unitType);
  }

  async manageSupply(foodRanges) {
    if (!foodRanges || foodRanges.indexOf(this.foodUsed) > -1) {
      if (isSupplyNeeded(this.agent, this.data, this.resources)) {
        switch (race) {
          // TODO: remove third parameter and handle undefined in train function.
          case Race.TERRAN:
            await this.build(this.foodUsed, SUPPLYDEPOT, this.units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).length);
            break;
          case Race.PROTOSS:
            await this.build(this.foodUsed, PYLON, this.units.getById(PYLON).length);
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
        this.collectedActions.push(...await restorePower(this.world));
        break;
    }
  }
  async push(foodRanges) {
    const label = 'pusher';
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      if (this.state.pushMode === false && !this.state.cancelPush) {
        [...this.mainCombatTypes, ...this.supportUnitTypes].forEach(type => {
          this.units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')).forEach(unit => unit.labels.set(label, true));
        });
        console.log('getSupply(this.units.withLabel(label), this.data)', getSupply(this.data, this.units.withLabel(label)));
        this.state.pushMode = true;
      }
    }
    if (this.units.withLabel(label).length > 0 && !this.state.cancelPush) {
      if (this.outSupplied) {
        this.state.cancelPush = true;
        console.log('cancelPush');
      } else {
        this.collectedActions.push(...await push(this.world, this.mainCombatTypes, this.supportUnitTypes));
      }
    } else if (this.state.pushMode === true) {
      this.state.pushMode = false;
      this.state.cancelPush = true;
      console.log('cancelPush');
    }
  }
  scout(foodRanges, unitType, targetLocationFunction, conditions) {
    if (conditions && conditions.scoutType === 'earlyScout' && this.earlyScout === undefined) { this.earlyScout = true; }
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      const targetLocation = (this.map[targetLocationFunction] && this.map[targetLocationFunction]()) ? this.map[targetLocationFunction]().centroid : locationHelper[targetLocationFunction](this.map);
      const label = conditions && conditions.label ? conditions.label : 'scout';
      let labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      if (labelledScouts.length === 0) {
        if (conditions) {
          if (conditions.scoutType && !this[conditions.scoutType]) { return; }
          if (conditions.unitType) {
            if (this.units.getByType(conditions.unitType).length === conditions.unitCount) { this.setScout(unitType, label, targetLocation); }
          } else { this.setScout(unitType, label, targetLocation); }
        } else { this.setScout(unitType, label, targetLocation); }
        labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        const [scout] = labelledScouts;
        if (scout) {
          if (distance(scout.pos, targetLocation) > 16) {
            const unitCommand = {
              abilityId: MOVE,
              targetWorldSpacePos: targetLocation,
              unitTags: [scout.tag],
            }
            this.collectedActions.push(unitCommand);
          }
        }
      }
    }
  }
  setScout(unitType, label, location) {
    let [unit] = this.units.getClosest(
      location,
      this.units.getById(unitType).filter(unit => {
        const condition = [
          unit.noQueue,
          unit.orders.findIndex(order => order.abilityId === MOVE) > -1,
          unit.isConstructing() && unit.unitType === PROBE,
          !unit.isWorker()
        ];
        return condition.some(condition => condition);
      })
    );
    if (!unit) { [unit] = this.units.getClosest(location, this.units.getById(unitType).filter(unit => unit.unitType === unitType && !unit.isConstructing() && unit.isGathering())); }
    if (unit) {
      console.log(unit.orders[0] && unit.orders[0].abilityId)
      unit.labels.clear();
      if (!unit.labels.get(label)) {
        unit.labels.set(label, true);
        console.log(`Set ${label}`);
      }
    }
  }
  async train(food, unitType, targetCount) {
    if (this.foodUsed >= food) {
      let abilityId = this.data.getUnitTypeData(unitType).abilityId;
      if (checkUnitCount(this.world, unitType, targetCount) || targetCount === null) {
        if (canBuild(this.agent, this.world.data, unitType)) {
          const trainer = this.units.getProductionUnits(unitType).find(unit => {
            const pendingOrders = unit.pendingOrders ? unit.pendingOrders : [];
            const noQueue = unit.noQueue && pendingOrders.length === 0;
            return (
              noQueue ||
              (unit.hasReactor() && unit.orders.length + pendingOrders.length < 2)
            ) &&
              unit.abilityAvailable(abilityId);
          });
          if (trainer) {
            const unitCommand = {
              abilityId,
              unitTags: [trainer.tag],
            }
            await actions.sendAction([unitCommand]);
            setPendingOrders(trainer, unitCommand);
          } else {
            abilityId = WarpUnitAbility[unitType];
            const warpGates = this.units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
            if (warpGates.length > 0) {
              warpIn(this.resources, this, unitType);
            } else {
              this.state.pauseBuilding = true;
              return;
            }
          }
          this.state.pauseBuilding = false;
          this.selectedTypeToBuild = null;
          console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`);
        } else {
          if (!this.agent.canAfford(unitType)) {
            console.log(`Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, this.state.pauseBuilding);
            const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
            await balanceResources(this.world, mineralCost / vespeneCost);
          }
          this.state.pauseBuilding = true;
          this.state.continueBuild = false;
        }
      }
    }
  }
  async upgrade(food, upgradeId) {
    if (this.foodUsed >= food) {
      const upgradeName = getStringNameOfConstant(Upgrade, upgradeId)
      upgradeId = mismatchMappings[upgradeName] ? Upgrade[mismatchMappings[upgradeName]] : Upgrade[upgradeName];
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
          const { mineralCost, vespeneCost } = this.data.getUpgradeData(upgradeId);
          await balanceResources(this.world, mineralCost / vespeneCost);
          this.state.pauseBuilding = true;
          this.state.continueBuild = false;
        }
      }
    }
  }

  async runPlan() {
    this.state.continueBuild = true;
    for (let step = 0; step < this.planOrders.length; step++) {
      if (this.state.continueBuild) {
        const planStep = this.planOrders[step];
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
            this.unitType = unitType;
            const enemyBuild = planStep[5];
            if (enemyBuild && this.state.enemyBuildType !== enemyBuild && !this.earlyScout) { break; }
            await this.build(foodTarget, unitType, targetCount, planStep[4] ? await this[planStep[4]](unitType) : []);
            break;
          case 'buildWorkers': if (!this.state.pauseBuilding) { await this.buildWorkers(planStep[0], planStep[2] ? planStep[2] : null); } break;
          case 'continuouslyBuild':
            const foodRanges = planStep[0];
            if (this.resourceTrigger && foodRanges.indexOf(this.foodUsed) > -1) { await continuouslyBuild(this.world, this, planStep[2], planStep[3]); } break;
          case 'harass': if (this.state.enemyBuildType === 'standard') { await harass(this.world, this.state); } break;
          case 'liftToThird': if (this.foodUsed >= foodTarget) { await liftToThird(this.resources); break; }
          case 'maintainQueens': if (this.foodUsed >= foodTarget) { await maintainQueens(this.resources, this.data, this.agent); } break;
          case 'manageSupply': await this.manageSupply(planStep[0]); break;
          case 'push': this.push(foodTarget); break;
          case 'scout':
            unitType = planStep[2];
            const targetLocationFunction = planStep[3];
            conditions = planStep[4];
            if (!conditions) { conditions = {}; }
            if (targetLocationFunction.includes('get')) {
              const label = targetLocationFunction.replace('get', 'scout')
              conditions.label = label;
            } else {
              conditions.label = targetLocationFunction
            }
            this.scout(foodTarget, unitType, targetLocationFunction, conditions);
            break;
          case 'train':
            unitType = planStep[2];
            try { await this.train(foodTarget, unitType, targetCount); } catch (error) { console.log(error) } break;
          case 'swapBuildings':
            conditions = planStep[2];
            if (this.foodUsed >= foodTarget) { await swapBuildings(this.world, conditions); }
            break;
          case 'upgrade':
            const upgradeId = planStep[2];
            await this.upgrade(foodTarget, upgradeId);
            break;
        }
      } else {
        console.log('step', step);
        break;
      }
    }
  }
}

module.exports = AssemblePlan;