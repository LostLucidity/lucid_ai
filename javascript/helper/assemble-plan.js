//@ts-check
"use strict"

const { PYLON, WARPGATE, OVERLORD, SUPPLYDEPOT, SUPPLYDEPOTLOWERED, MINERALFIELD, BARRACKS, GATEWAY, ZERGLING, PHOTONCANNON, PROBE } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { MOVE } = require("@node-sc2/core/constants/ability");
const rallyUnits = require("./rally-units");
const { WarpUnitAbility, UnitType, Upgrade, UnitTypeId, Ability } = require("@node-sc2/core/constants");
const continuouslyBuild = require("./continuously-build");
const { TownhallRace, GasMineRace, WorkerRace } = require("@node-sc2/core/constants/race-map");
const { defend, attack, push } = require("./behavior/army-behavior");
const threats = require("./base-threats");
const { generalScouting, cancelEarlyScout } = require("../builds/scouting");
const { labelQueens, inject, spreadCreep, maintainQueens, spreadCreepByQueen } = require("../builds/zerg/queen-management");
const { overlordCoverage } = require("../builds/zerg/overlord-management");
const { moveAway } = require("../builds/helper");
const { salvageBunker } = require("../builds/terran/salvage-bunker");
const { expand } = require("./general-actions");
const { repairBurningStructures, repairDamagedMechUnits, repairBunker, finishAbandonedStructures } = require("../builds/terran/repair");
const { getMiddleOfNaturalWall, findPosition, getCandidatePositions, getInTheMain } = require("./placement/placement-helper");
const { restorePower, warpIn } = require("./protoss");
const { liftToThird, addAddOn, swapBuildings } = require("./terran");
const { balanceResources } = require("../systems/manage-resources");
const { addonTypes } = require("@node-sc2/core/constants/groups");
const runBehaviors = require("./behavior/run-behaviors");
const { haveAvailableProductionUnitsFor } = require("../systems/unit-training/unit-training-service");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { checkUnitCount } = require("../systems/track-units/track-units-service");
const mismatchMappings = require("../systems/salt-converter/mismatch-mapping");
const { getStringNameOfConstant } = require("../services/logging-service");
const { keepPosition } = require("../services/placement-service");
const { getEnemyWorkers, deleteLabel, setPendingOrders, getMineralFieldTarget, calculateTotalHealthRatio } = require("../systems/unit-resource/unit-resource-service");
const planService = require("../services/plan-service");
const { getNextPlanStep } = require("../services/plan-service");
const scoutingService = require("../systems/scouting/scouting-service");
const trackUnitsService = require("../systems/track-units/track-units-service");
const unitTrainingService = require("../systems/unit-training/unit-training-service");
const { checkBuildingCount, getAbilityIdsForAddons, getUnitTypesWithAbilities, assignAndSendWorkerToBuild, setAndLogExecutedSteps, unpauseAndLog, premoveBuilderToPosition, isSupplyNeeded, canBuild, findPlacements, getFoodUsed, shortOnWorkers } = require("../services/world-service");
const { getAvailableExpansions, getNextSafeExpansion } = require("./expansions");
const planActions = require("../systems/execute-plan/plan-actions");
const { addEarmark, getSupply } = require("../services/data-service");
const worldService = require("../services/world-service");
const { buildGasMine } = require("../systems/execute-plan/plan-actions");
const harassService = require("../systems/harass/harass-service");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { pointsOverlap } = require("./utilities");
const resourceManagerService = require("../services/resource-manager-service");
const { getTargetLocation } = require("../services/map-resource-service");

let actions;
let race;
let ATTACKFOOD = 194;

class AssemblePlan {
  /**
   * @param {{ orders: any; unitTypes: { mainCombatTypes: any; defenseTypes: [UnitTypeId]; defenseStructures: any; supportUnitTypes: any; }; }} plan
   */
  constructor(plan) {
    this.collectedActions = [];
    /** @type {false | Point2D} */
    this.foundPosition = false;
    planService.legacyPlan = plan.orders;
    this.mainCombatTypes = plan.unitTypes.mainCombatTypes;
    this.defenseTypes = plan.unitTypes.defenseTypes;
    this.defenseStructures = plan.unitTypes.defenseStructures;
    this.supportUnitTypes = plan.unitTypes.supportUnitTypes;
  }
  onEnemyFirstSeen(seenEnemyUnit) {
    scoutingService.opponentRace = seenEnemyUnit.data().race;
  }
  onGameStart(world) {
    actions = world.resources.get().actions;
    race = world.agent.race;
    scoutingService.opponentRace = world.agent.opponent.race;
  }
  /**
   * @param {World} world
   * @param {any} state
   */
  async onStep(world, state) {
    this.collectedActions = [];
    this.state = state;
    this.state.defenseStructures = this.defenseStructures;
    const { resources } = world;
    this.world = world;
    this.agent = world.agent;
    this.data = world.data;
    if (this.foodUsed > this.world.agent.foodUsed) {
      planService.pausePlan = false;
    }
    this.foodUsed = this.world.agent.foodUsed;
    this.resources = world.resources;
    this.frame = this.resources.get().frame;
    this.map = this.resources.get().map;
    this.units = this.resources.get().units;
    this.resourceTrigger = this.agent.minerals > 512 && this.agent.vespene > 256;
    this.threats = threats(this.resources, this.state);
    const { outpowered } = worldService;
    const trainUnitConditions = [
      outpowered,
      unitTrainingService.workersTrainingTendedTo && !planService.isPlanPaused,
      !shortOnWorkers(world) && !planService.isPlanPaused,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      outpowered ? console.log('Scouted higher power') : console.log('Free build mode.');
      const nextStep = getNextPlanStep(this.foodUsed);
      worldService.unitProductionAvailable = this.defenseTypes.some(type => haveAvailableProductionUnitsFor(world, type));
      if (worldService.unitProductionAvailable) {
        const haveProductionAndTechForTypes = this.defenseTypes.filter(type => {
          return [
            haveAvailableProductionUnitsFor(world, type),
            this.agent.hasTechFor(type),
            outpowered || (nextStep ? this.data.getUnitTypeData(type).foodRequired <= nextStep[0] - this.foodUsed : true),
          ].every(condition => condition);
        });
        if (haveProductionAndTechForTypes.length > 0) {
          this.selectedTypeToBuild = haveProductionAndTechForTypes.includes(this.selectedTypeToBuild) ? this.selectedTypeToBuild : haveProductionAndTechForTypes[Math.floor(Math.random() * haveProductionAndTechForTypes.length)];
          let { mineralCost, vespeneCost } = this.data.getUnitTypeData(this.selectedTypeToBuild);
          if (this.selectedTypeToBuild === ZERGLING) {
            mineralCost += mineralCost;
            vespeneCost += vespeneCost;
          }
          const freeBuildThreshold = this.agent.minerals >= (mineralCost * 2) && this.agent.vespene >= (vespeneCost * 2);
          if (outpowered || freeBuildThreshold) {
            await this.train(resources, this.foodUsed, this.selectedTypeToBuild, null);
          }
        }
      } else {
        // if we have no production units available, we need to skip production
      }
    }
    await this.runPlan(world);
    if (this.foodUsed < ATTACKFOOD) {
      if (!this.state.pushMode) {
        if (this.state.defenseMode) {
          this.collectedActions.push(...await defend(world, this.mainCombatTypes, this.supportUnitTypes, this.threats));
        } else {
          this.collectedActions.push(...rallyUnits(world, this.supportUnitTypes, this.state.defenseLocation));
        }
      }
    } else {
      const { selfCombatSupply, inFieldSelfSupply } = trackUnitsService;
      if (!worldService.outpowered || selfCombatSupply === inFieldSelfSupply) { this.collectedActions.push(...attack(this.world, this.mainCombatTypes, this.supportUnitTypes)); }
    }
    if (this.agent.minerals > 512) { this.manageSupply(world); }
    if (getFoodUsed(world) >= 132 && !shortOnWorkers(world)) { this.collectedActions.push(...await expand(world)); }
    this.checkEnemyBuild();
    let completedBases = this.units.getBases().filter(base => base.buildProgress >= 1);
    if (completedBases.length >= 3) {
      this.collectedActions.push(...salvageBunker(this.units));
      this.state.defendNatural = false;
      scoutingService.enemyBuildType = 'midgame';
    } else {
      this.state.defendNatural = true;
    }
    await this.raceSpecificManagement();
    this.collectedActions.push(...await runBehaviors(world));
    const label = 'pendingOrders';
    this.units.withLabel(label).forEach(unit => unit.labels.delete(label));
    this.data.get('earmarks').forEach(earmark => this.data.settleEarmark(earmark.name));
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
    if (getFoodUsed(this.world) >= food) {
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
          planService.pausePlan = false;
        } else {
          if (conditions === undefined || conditions.targetType === undefined) {
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      }
    }
  }
  /**
   * @param {World} world
   * @param {number} food 
   * @param {UnitTypeId} unitType 
   * @param {number} targetCount 
   * @param {Point2D[]} candidatePositions 
   */
  async build(world, food, unitType, targetCount, candidatePositions = []) {
    const { resources } = world;
    if (getFoodUsed(this.world) + 1 >= food) {
      const stepAhead = getFoodUsed(this.world) + 1 === food;
      if (checkBuildingCount(this.world, unitType, targetCount)) {
        if (stepAhead) {
          addEarmark(this.data, this.data.getUnitTypeData(WorkerRace[race]));
        }
        switch (true) {
          case GasMineRace[race] === unitType:
            this.collectedActions.push(...await buildGasMine(this.world, unitType, targetCount, stepAhead));
            break;
          case TownhallRace[race].includes(unitType):
            if (TownhallRace[race].indexOf(unitType) === 0) {
              if (this.units.getBases().length === 2 && race === Race.TERRAN) {
                candidatePositions = await getInTheMain(this.resources, unitType);
                await this.buildBuilding(world, unitType, candidatePositions, stepAhead);
              } else {
                resourceManagerService.availableExpansions = resourceManagerService.availableExpansions.length === 0 ? getAvailableExpansions(resources) : resourceManagerService.availableExpansions;
                const { availableExpansions } = resourceManagerService;
                candidatePositions = availableExpansions.length > 0 ? [await getNextSafeExpansion(this.world, availableExpansions)] : [];
                await this.buildBuilding(world, unitType, candidatePositions, stepAhead);
              }
            } else {
              if (!stepAhead) {
                const actions = await planActions.ability(this.world, this.data.getUnitTypeData(unitType).abilityId);
                if (actions.length > 0) {
                  unpauseAndLog(this.world, UnitTypeId[unitType]);
                  addEarmark(this.data, this.data.getUnitTypeData(unitType));
                  this.collectedActions.push(...actions);
                }
              } else {
                addEarmark(this.data, this.data.getUnitTypeData(unitType));
              }
            }
            break;
          case addonTypes.includes(unitType):
            const abilityIds = getAbilityIdsForAddons(this.data, unitType);
            let canDoTypes = getUnitTypesWithAbilities(this.data, abilityIds);
            const addOnUnits = this.units.withLabel('addAddOn').filter(addOnUnit => {
              const addOnPosition = addOnUnit.labels.get('addAddOn');
              if (addOnPosition && distance(addOnUnit.pos, addOnPosition) < 1) { addOnUnit.labels.delete('addAddOn'); }
              else { return true; }
            });
            const availableAddOnUnits = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId) && (!unit['pendingOrders'] || unit['pendingOrders'].length === 0)));
            const unitsCanDo = availableAddOnUnits.length > 0 ? addOnUnits : this.units.getByType(canDoTypes).filter(unit => {
              return abilityIds.some(abilityId => unit.abilityAvailable(abilityId) && (!unit['pendingOrders'] || unit['pendingOrders'].length === 0));
            });
            if (unitsCanDo.length > 0) {
              let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
              await addAddOn(this.world, unitCanDo, unitType, stepAhead)
            } else {
              if (!stepAhead) {
                const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
                await balanceResources(this.world, mineralCost / vespeneCost);
                planService.pausePlan = true;
                planService.continueBuild = false;
              }
            }
            break;
          default:
            if (PHOTONCANNON === unitType) { 
              candidatePositions = this.map.getNatural().areas.placementGrid;
            }
            if (candidatePositions.length === 0 && (this.foundPosition === false)) { candidatePositions = await findPlacements(this.world, unitType); }
            await this.buildBuilding(world, unitType, candidatePositions, stepAhead);
        }
      }
    }
  }

  /**
   * @param {World} world
   * @param {UnitTypeId} unitType 
   * @param {Point2D[]} candidatePositions 
   * @param {boolean} stepAhead 
   */
  async buildBuilding(world, unitType, candidatePositions, stepAhead) {
    this.foundPosition = await setFoundPosition(world, this.foundPosition, unitType, candidatePositions);
    if (this.foundPosition) {
      if (this.agent.canAfford(unitType) && !stepAhead) {
        if (await actions.canPlace(unitType, [this.foundPosition])) {
          await actions.sendAction(assignAndSendWorkerToBuild(this.world, unitType, this.foundPosition));
          planService.pausePlan = false;
          planService.continueBuild = true;
          this.foundPosition = false;
        } else {
          this.foundPosition = keepPosition(this.resources, unitType, this.foundPosition) ? this.foundPosition : false;
          if (this.foundPosition) {
            this.collectedActions.push(...premoveBuilderToPosition(this.world, this.foundPosition, unitType, stepAhead));
          }
          if (!stepAhead) {
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      } else {
        this.collectedActions.push(...premoveBuilderToPosition(this.world, this.foundPosition, unitType, stepAhead));
        if (!stepAhead) {
          const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
          await balanceResources(this.world, mineralCost / vespeneCost);
          planService.pausePlan = true;
          planService.continueBuild = false;
        }
      }
    }
  }
  checkEnemyBuild() {
    const { frame } = this.resources.get();
    if (scoutingService.earlyScout) {
      if (frame.timeInSeconds() > 122) {
        scoutingService.earlyScout = false;
        console.log(scoutingService.scoutReport);
        cancelEarlyScout(this.units);
        return;
      } else {
        const suspiciousWorkerCount = getEnemyWorkers(this.world).filter(worker => distance(worker.pos, this.map.getEnemyMain().townhallPosition) > 16).length;
        if (suspiciousWorkerCount > 2) {
          scoutingService.enemyBuildType = 'cheese';
          scoutingService.scoutReport = `${scoutingService.enemyBuildType} detected:
            Worker Rush Detected: ${suspiciousWorkerCount} sus workers.`;
          scoutingService.earlyScout = false;
          console.log(scoutingService.scoutReport);
          cancelEarlyScout(this.units);
          return;
        }
        let conditions = [];
        const enemyFilter = { alliance: Alliance.ENEMY };
        switch (scoutingService.opponentRace) {
          case Race.PROTOSS: {
            const moreThanTwoGateways = this.units.getById(GATEWAY, enemyFilter).length > 2;
            if (moreThanTwoGateways) {
              console.log(frame.timeInSeconds(), 'More than two gateways');
              scoutingService.enemyBuildType = 'cheese';
              scoutingService.earlyScout = false;
            }
            conditions = [
              this.units.getById(GATEWAY, enemyFilter).length === 2,
            ];
            if (!conditions.every(c => c)) {
              scoutingService.enemyBuildType = 'cheese';
            } else {
              scoutingService.enemyBuildType = 'standard';
            }
            scoutingService.scoutReport = `${scoutingService.enemyBuildType} detected:
            Gateway Count: ${this.units.getById(GATEWAY, enemyFilter).length}.`;
            break;
          }
          case Race.TERRAN:
            // scout alive, more than 1 barracks.
            const moreThanOneBarracks = this.units.getById(BARRACKS, enemyFilter).length > 1;
            if (scoutingService.enemyBuildType !== 'cheese') {
              if (moreThanOneBarracks) {
                console.log(frame.timeInSeconds(), 'More than one barracks');
                scoutingService.enemyBuildType = 'cheese';
              }
            }
            // 1 barracks and 1 gas, second command center
            conditions = [
              this.units.getById(BARRACKS, enemyFilter).length === 1,
              this.units.getById(GasMineRace[scoutingService.opponentRace], enemyFilter).length === 1,
              !!this.map.getEnemyNatural().getBase()
            ];
            if (!conditions.every(c => c)) {
              scoutingService.enemyBuildType = 'cheese';
            } else {
              scoutingService.enemyBuildType = 'standard';
            }
            scoutingService.scoutReport = `${scoutingService.enemyBuildType} detected:
            Barracks Count: ${this.units.getById(BARRACKS, enemyFilter).length}.
            Gas Mine Count: ${this.units.getById(GasMineRace[scoutingService.opponentRace], enemyFilter).length}.
            Enemy Natural detected: ${!!this.map.getEnemyNatural().getBase()}.`;
            break;
        }
      }
      if (!scoutingService.earlyScout) {
        console.log(scoutingService.scoutReport);
        cancelEarlyScout(this.units);
      }
    }
  }

  async getMiddleOfNaturalWall(unitType) {
    return await getMiddleOfNaturalWall(this.resources, unitType);
  }

  /**
   * @param {World} world
   * @param {null|number[]} foodRanges 
   * @returns {Promise<void>}
   */
  async manageSupply(world, foodRanges = null) {
    if (!foodRanges || foodRanges.indexOf(this.foodUsed) > -1) {
      if (isSupplyNeeded(this.world, 0.2)) {
        this.foundPosition = false;
        switch (race) {
          case Race.TERRAN:
            await this.build(world, this.foodUsed, SUPPLYDEPOT, this.units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]).length);
            break;
          case Race.PROTOSS:
            await this.build(world, this.foodUsed, PYLON, this.units.getById(PYLON).length);
            break;
          case Race.ZERG:
            let { abilityId } = this.data.getUnitTypeData(OVERLORD);
            await this.train(world, this.foodUsed, OVERLORD, this.units.getById(OVERLORD).length + this.units.withCurrentOrders(abilityId).length);
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
        this.collectedActions.push(...inject(this.world));
        this.collectedActions.push(...overlordCoverage(this.units));
        this.collectedActions.push(...await spreadCreep(this.resources));
        this.collectedActions.push(...await spreadCreepByQueen(this.resources));
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
      if (worldService.outpowered) {
        this.state.cancelPush = true;
        deleteLabel(this.units, label);
        console.log('cancelPush');
      } else {
        this.collectedActions.push(...await push(this.world, this.mainCombatTypes, this.supportUnitTypes));
      }
    } else if (this.state.pushMode === true) {
      this.state.pushMode = false;
      this.state.cancelPush = true;
      deleteLabel(this.units, label);
      console.log('cancelPush');
    }
  }
  /**
   * @param {MapResource} map
   * @param {number[]} foodRanges 
   * @param {UnitTypeId} unitType 
   * @param {string} targetLocation
   * @param {{scoutType: string, label: string, unitType: UnitTypeId, unitCount: number}} conditions 
   * @returns 
   */
  scout(map, foodRanges, unitType, targetLocation, conditions) {
    if (foodRanges.indexOf(this.foodUsed) > -1) {
      const location = getTargetLocation(map, `get${targetLocation}`);
      const label = conditions && conditions.label ? conditions.label : 'scout';
      let labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
      const hasOrderToTargetLocation = labelledScouts.filter(scout => scout.orders.find(order => order.targetWorldSpacePos && distance(order.targetWorldSpacePos, location) < 16)).length > 0;
      if (!hasOrderToTargetLocation) {
        if (conditions) {
          if (conditions.scoutType && !scoutingService[conditions.scoutType]) { return; }
          if (conditions.unitType) {
            if (this.units.getByType(conditions.unitType).length === conditions.unitCount) { this.setScout(unitType, label, targetLocation); }
          } else { this.setScout(unitType, label, location); }
        } else { this.setScout(unitType, label, location); }
        labelledScouts = this.units.withLabel(label).filter(unit => unit.unitType === unitType && !unit.isConstructing());
        const [scout] = labelledScouts;
        if (scout) {
          if (distance(scout.pos, location) > 16 && calculateTotalHealthRatio(this.units, scout) > 1 / 2 && !scout.labels.has('Threatened')) {
            const unitCommand = {
              abilityId: MOVE,
              targetWorldSpacePos: location,
              unitTags: [scout.tag],
            }
            this.collectedActions.push(unitCommand);
            console.log('Scout sent');
            setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType), `scouting ${targetLocation}`);
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
      const scoutLog = [];
      if (unit.orders[0]) {
        scoutLog.push('Scout order', getStringNameOfConstant(Ability, unit.orders[0].abilityId));
      }
      if (!unit.labels.has(label)) {
        unit.labels.clear();
        unit.labels.set(label, location);
        scoutLog.push(`Set ${label}`);
      }
      console.log(scoutLog);
    }
  }
  /**
   * @param {World} world
   * @param {number} food
   * @param {number} unitType
   * @param {null|number} targetCount
   * @returns {Promise<void>}
   */
  async train(world, food, unitType, targetCount) {
    if (getFoodUsed(this.world) >= food) {
      let abilityId = this.data.getUnitTypeData(unitType).abilityId;
      if (checkUnitCount(this.world, unitType, targetCount) || targetCount === null) {
        if (canBuild(this.world, unitType)) {
          const trainer = this.units.getProductionUnits(unitType).find(unit => {
            const pendingOrders = unit['pendingOrders'] ? unit['pendingOrders'] : [];
            const noQueue = unit.noQueue && pendingOrders.length === 0;
            return (
              noQueue ||
              (unit.hasReactor() && unit.orders.length + pendingOrders.length < 2)
            ) &&
              unit.abilityAvailable(abilityId);
          });
          const unitTypeData = this.data.getUnitTypeData(unitType);
          if (trainer) {
            const unitCommand = {
              abilityId,
              unitTags: [trainer.tag],
            }
            await actions.sendAction([unitCommand]);
            setPendingOrders(trainer, unitCommand);
            planService.pendingFood += unitTypeData.foodRequired;
          } else {
            abilityId = WarpUnitAbility[unitType];
            const warpGates = this.units.getById(WARPGATE).filter(warpgate => warpgate.abilityAvailable(abilityId));
            if (warpGates.length > 0) {
              warpIn(this.resources, this, unitType);
            } else {
              if (targetCount !== null) {
                planService.pausePlan = true;
              }
              return;
            }
          }
          planService.pausePlan = false;
          setAndLogExecutedSteps(this.world, this.frame.timeInSeconds(), getStringNameOfConstant(UnitType, unitType));
          this.selectedTypeToBuild = null;
          console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`);
          addEarmark(this.data, unitTypeData);
        } else {
          if (isSupplyNeeded(this.world) && unitType !== OVERLORD) {
            await this.manageSupply(world);
          } else if (!this.agent.canAfford(unitType)) {
            console.log(`Cannot afford ${Object.keys(UnitType).find(type => UnitType[type] === unitType)}`, planService.isPlanPaused);
            const { mineralCost, vespeneCost } = this.data.getUnitTypeData(unitType);
            await balanceResources(this.world, mineralCost / vespeneCost);
          }
          if (targetCount !== null) {
            planService.pausePlan = true;
            planService.continueBuild = false;
          }
        }
      }
    }
  }
  /**
   * @param {World} world
   * @param {number} food
   * @param {number} upgradeId
   */
  async upgrade(world, food, upgradeId) {
    const { agent, data, resources } = world;
    const { frame, units } = resources.get();
    if (getFoodUsed(world) >= food) {
      const upgradeName = getStringNameOfConstant(Upgrade, upgradeId)
      upgradeId = mismatchMappings[upgradeName] ? Upgrade[mismatchMappings[upgradeName]] : Upgrade[upgradeName];
      const upgraders = units.getUpgradeFacilities(upgradeId);
      const upgradeData = data.getUpgradeData(upgradeId);
      const { abilityId } = upgradeData;
      const foundUpgradeInProgress = upgraders.find(upgrader => upgrader.orders.find(order => order.abilityId === abilityId));
      const { upgradeIds } = agent;
      if (upgradeIds === undefined) return;
      if (!upgradeIds.includes(upgradeId) && foundUpgradeInProgress === undefined) {
        const { mineralCost, vespeneCost } = data.getUpgradeData(upgradeId);
        if (mineralCost === undefined || vespeneCost === undefined) return;
        if (agent.canAffordUpgrade(upgradeId)) {
          const upgrader = units.getUpgradeFacilities(upgradeId).find(unit => unit.noQueue && unit.abilityAvailable(abilityId));
          if (upgrader) {
            const unitCommand = { abilityId, unitTags: [upgrader.tag] };
            await actions.sendAction([unitCommand]);
            planService.pausePlan = false;
            setAndLogExecutedSteps(world, frame.timeInSeconds(), upgradeName);
            console.log(`Upgrading ${upgradeName}`);
          } else {
            console.log(`${upgradeName} not available`);
            await balanceResources(world, mineralCost / vespeneCost);
          }
        } else {
          console.log(`Cannot afford ${upgradeName}`);
          await balanceResources(world, mineralCost / vespeneCost);
        }
        addEarmark(data, upgradeData);
      }
    }
  }

  /**
   * @param {World} world
   */
  async runPlan(world) {
    const { resources } = world;
    const { map } = resources.get();
    planService.continueBuild = true;
    planService.pendingFood = 0;
    for (let step = 0; step < planService.legacyPlan.length; step++) {
      planService.currentStep = step;
      if (planService.continueBuild) {
        const planStep = planService.legacyPlan[step];
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
          case 'build': {
            unitType = planStep[2];
            this.unitType = unitType;
            const enemyBuild = planStep[5];
            if (enemyBuild && scoutingService.enemyBuildType !== enemyBuild && !scoutingService.earlyScout) { break; }
            const candidatePositions = planStep[4] ? await getCandidatePositions(this.resources, planStep[4], unitType) : [];
            await this.build(world, foodTarget, unitType, targetCount, candidatePositions);
            break;
          }
          case 'continuouslyBuild':
            const foodRanges = planStep[0];
            if (this.resourceTrigger && foodRanges.indexOf(this.foodUsed) > -1) { await continuouslyBuild(this.world, this, planStep[2], planStep[3]); } break;
          case 'harass': if (scoutingService.enemyBuildType === 'standard') harassService.harassOn = true; break;
          case 'liftToThird': if (getFoodUsed(this.world) >= foodTarget) { await liftToThird(this.resources); } break;
          case 'maintainQueens': if (getFoodUsed(this.world) >= foodTarget) { await maintainQueens(this.world); } break;
          case 'manageSupply': await this.manageSupply(world, planStep[0]); break;
          case 'push': this.push(foodTarget); break;
          case 'scout': {
            unitType = planStep[2];
            const targetLocation = planStep[3];
            conditions = planStep[4];
            if (!conditions) { conditions = {}; }
            const label = `scout${targetLocation}`
            conditions.label = label;
            this.scout(map, foodTarget, unitType, targetLocation, conditions);
            break;
          }
          case 'train':
            unitType = planStep[2];
            try { await this.train(resources, foodTarget, unitType, targetCount); } catch (error) { console.log(error) } break;
          case 'swapBuildings':
            conditions = planStep[2];
            if (getFoodUsed(this.world) >= foodTarget) { await swapBuildings(this.world, conditions); }
            break;
          case 'upgrade':
            const upgradeId = planStep[2];
            await this.upgrade(this.world, foodTarget, upgradeId);
            break;
        }
      } else {
        break;
      }
    }
    planService.latestStep = planService.currentStep;
    planService.currentStep = null;
    if (!planService.pausedThisRound) {
      planService.pausePlan = false;
    }
  }
}

module.exports = AssemblePlan;

/**
 * @param {World} world 
 * @param {false | Point2D} foundPosition 
 * @param {UnitTypeId} unitType 
 * @param {Point2D[]} candidatePositions 
 * @returns {Promise<Point2D | false>}
 */
async function setFoundPosition(world, foundPosition, unitType, candidatePositions) {
  const { resources } = world;
  if (foundPosition) {
    const { map, units } = resources.get();
    const areEnemyUnitsInWay = checkIfEnemyUnitsInWay(units, unitType, foundPosition);
    const enemyBlockingExpansion = areEnemyUnitsInWay && TownhallRace[race][0] === unitType;
    if (map.isPlaceableAt(unitType, foundPosition) && !enemyBlockingExpansion) {
      return foundPosition;
    }
  } 
  return await findPosition(resources, unitType, candidatePositions);
}

/**
 * @param {UnitResource} units
 * @param {UnitTypeId} unitType
 * @param {Point2D} position
 * @returns {boolean}
 */
function checkIfEnemyUnitsInWay(units, unitType, position) {
  const footprint = getFootprint(unitType);
  if (footprint === undefined) return false;
  const enemyUnitCoverage = units.getAlive(Alliance.ENEMY)
    .filter(enemyUnit => enemyUnit.pos && distance(enemyUnit.pos, position) < 16)
    .map(enemyUnit => {
      const { pos, radius, unitType } = enemyUnit;
      if (pos === undefined || radius === undefined) return [];
      if (!enemyUnit.isStructure()) {
        return [pos, ...gridsInCircle(pos, radius)];
      } else {
        const footprint = getFootprint(unitType);
        if (footprint === undefined) return [];
        return cellsInFootprint(pos, footprint);
      }
    }).flat();
  return pointsOverlap(enemyUnitCoverage, cellsInFootprint(position, footprint));
}