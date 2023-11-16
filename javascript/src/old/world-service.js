//@ts-check
"use strict"

const fs = require('fs');
const { UnitTypeId, Ability, UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, CANCEL_QUEUE5, TRAIN_ZERGLING, RALLY_BUILDING, HARVEST_GATHER, SMART, ATTACK } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance, RaceId } = require("@node-sc2/core/constants/enums");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes, morphMapping, flyingTypesMapping } = require("../helper/groups");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine } = require("../systems/manage-resources");
const dataService = require("../services/data-service");
const planService = require("../services/plan-service");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { pointsOverlap } = require("../helper/utilities");
const scoutingService = require("../systems/scouting/scouting-service");
const { getTravelDistancePerStep } = require("../services/frames-service");
const scoutService = require("../systems/scouting/scouting-service");
const path = require('path');
const foodUsedService = require('../services/food-used-service');
const trackUnitsService = require('../systems/track-units/track-units-service');
const { canAttack } = require('../services/resources-service');
const { moveAwayPosition, getDistance } = require('../services/position-service');
const resourceManagerService = require('../services/resource-manager-service');
const { getAddOnPlacement, getAddOnBuildingPosition } = require('../helper/placement/placement-utilities');
const unitTrainingService = require('../systems/unit-training/unit-training-service');
const microService = require('../services/micro-service');
const { WARPGATE } = require('@node-sc2/core/constants/unit-type');
const { scanCloakedEnemy } = require('../helper/terran');
const groupTypes = require('@node-sc2/core/constants/groups');
const unitService = require('../services/unit-service');
const { getDPSHealth, calculateHealthAdjustedSupply, calculateNearDPSHealth } = require('./services/combat-statistics');
const { getClosestPathWithGasGeysers, getClosestSafeMineralField } = require('./services/utility-service');
const pathFindingService = require('./services/pathfinding/pathfinding-service');
const { getWeaponDPS } = require('./shared-utilities/combat-utilities');
const { getUnitsTraining, getUnitsWithCurrentOrders, getById } = require('./services/unit-retrieval');
const enemyTrackingServiceV2 = require('./services/enemy-tracking');
const { createUnitCommand } = require('./shared-utilities/command-utilities');
const { addEarmark } = require('./shared-utilities/common-utilities');
const { getCurrentlyEnrouteConstructionGrids } = require('./shared-utilities/construction-utils');
const { getFoodUsed } = require('./shared-utilities/info-utils');
const unitRetrievalService = require('./services/unit-retrieval');
const loggingService = require('./logging/logging-service');
const { getProjectedPosition } = require('./shared-utilities/vector-utils');
const { getCombatRally } = require('./services/shared-config/combatRallyConfig');
const { MicroManagementService } = require('./services/army-management/micro-management');
const serviceLocator = require('./services/service-locator');
/** @type {import('./interfaces/i-army-management-service').IArmyManagementService} */
const armyManagementService = serviceLocator.get('armyManagementService');

  
const worldService = {
  availableProductionUnits: new Map(),
  /** @type {number} */
  totalEnemyDPSHealth: 0,
  /** @type {number} */
  totalSelfDPSHealth: 0,
  /** @type {boolean} */
  unitProductionAvailable: true,

  /**
   * Adds addon, with placement checks and relocating logic.
   * @param {World} world 
   * @param {Unit} unit 
   * @param {UnitTypeId} addOnType 
   * @returns {Promise<void>}
   */
  addAddOn: async (world, unit, addOnType) => {
    const { landingAbilities, liftingAbilities } = groupTypes;
    const { data, resources } = world;
    const { actions } = resources.get();
    const { tag } = unit; if (tag === undefined) return;

    addOnType = updateAddOnType(addOnType, countTypes);
    const unitTypeToBuild = getUnitTypeToBuild(unit, flyingTypesMapping, addOnType);

    const { abilityId } = data.getUnitTypeData(unitTypeToBuild); if (abilityId === undefined) return;
    const unitCommand = { abilityId, unitTags: [tag] };

    if (!unit.noQueue || unit.labels.has('swapBuilding') || unitService.getPendingOrders(unit).length > 0) {
      return;
    }

    const availableAbilities = unit.availableAbilities();

    if (unit.abilityAvailable(abilityId)) {
      if (await attemptBuildAddOn(world, unit, addOnType, unitCommand)) {
        addEarmark(data, data.getUnitTypeData(addOnType));
        return;
      }
    }

    if (availableAbilities.some(ability => liftingAbilities.includes(ability))) {
      if (await attemptLiftOff(actions, unit)) {
        return;
      }
    }

    if (availableAbilities.some(ability => landingAbilities.includes(ability))) {
      await attemptLand(world, unit, addOnType);
    }
  },

  /**
   * 
   * @param {World} world 
   * @param {{ combatPoint: Unit; combatUnits: Unit[]; enemyTarget: Unit; supportUnits?: any[]; }} army 
   * @param {Unit[]} enemyUnits 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  attackWithArmy: (world, army, enemyUnits) => {
    const { changelingTypes } = groupTypes;
    const { SIEGETANKSIEGED } = UnitType;
    const { tankBehavior } = unitResourceService;
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const pointType = army.combatPoint.unitType;
    const pointTypeUnits = units.getById(pointType);
    const nonPointTypeUnits = army.combatUnits.filter(unit => !(unit.unitType === pointType) && unit.labels.size === 0);
    if (changelingTypes.includes(army.enemyTarget.unitType)) {
      const killChanglingCommand = createUnitCommand(ATTACK, pointTypeUnits);
      killChanglingCommand.targetUnitTag = army.enemyTarget.tag;
      collectedActions.push(killChanglingCommand);
    } else {
      const range = Math.max.apply(Math, world.data.getUnitTypeData(SIEGETANKSIEGED).weapons.map(weapon => { return weapon.range; }));
      const targetWorldSpacePos = distance(army.combatPoint.pos, army.enemyTarget.pos) > range ? army.combatPoint.pos : army.enemyTarget.pos;
      [...pointTypeUnits, ...nonPointTypeUnits].forEach(unit => {
        const [closestUnit] = units.getClosest(unit.pos, enemyUnits.filter(enemyUnit => distance(unit.pos, enemyUnit.pos) < 16));
        const microManagement = new MicroManagementService();
        if (!unit.isMelee() && closestUnit) { collectedActions.push(...microManagement.microRangedUnit(world, unit, closestUnit)); }
        else {
          const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
          if (unit.labels.get('combatPoint')) {
            unitCommand.targetWorldSpacePos = army.enemyTarget.pos;
          } else {
            unitCommand.targetWorldSpacePos = targetWorldSpacePos;
          }
          collectedActions.push(unitCommand);
        }
      });
      if (army.supportUnits.length > 0) {
        const supportUnitTags = army.supportUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: army.combatPoint.pos,
          unitTags: [...supportUnitTags],
        }
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.push(...tankBehavior(units));
    return collectedActions;
  },

  /**
   * Calculate DPS health base on ally units and enemy armor upgrades.
   * @param {World} world 
   * @param {UnitTypeId[]} unitTypes
   * @param {Alliance} alliance
   * @param {Unit[]} enemyUnits 
   * @returns {number}
   */
  calculateDPSHealthOfTrainingUnits: (world, unitTypes, alliance, enemyUnits) => {
    const { workerTypes } = groupTypes;
    return unitTypes.reduce((totalDPSHealth, unitType) => {
      if (workerTypes.includes(unitType)) {
        return totalDPSHealth;
      } else {
        return totalDPSHealth + worldService.getDPSHealthOfTrainingUnit(world, unitType, alliance, enemyUnits.map(enemyUnit => enemyUnit.unitType));
      }
    }, 0);
  },

  /**
  * Returns boolean on whether build step should be executed.
  * @param {World} world 
  * @param {UnitTypeId} unitType 
  * @param {number} targetCount 
  * @returns {boolean}
  */
  checkBuildingCount: (world, unitType, targetCount) => {
    return unitRetrievalService.getUnitTypeCount(world, unitType) === targetCount;
  },
  /**
   * @description Check if a unit type is available for production.
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {boolean}
   */
  checkProductionAvailability: (world, unitType) => {
    if (worldService.availableProductionUnits.has(unitType)) {
      return worldService.availableProductionUnits.get(unitType);
    }
    const haveAvailableProductionUnits = worldService.haveAvailableProductionUnitsFor(world, unitType);
    worldService.availableProductionUnits.set(unitType, haveAvailableProductionUnits);
    return haveAvailableProductionUnits;
  },

  /**
   * @param {World} world
   */
  clearUnsettledBuildingPositions: (world) => {
    const { resources } = world;
    const { map } = resources.get();
    /** @type {Map<number, false | Point2D>} */
    const buildingPositions = planService.buildingPositions;
    const unsettledBuildingPositions = [...buildingPositions.entries()].filter(([step, position]) => {
      const unitType = planService.legacyPlan[step][2];
      const isPlaceableAt = position && map.isPlaceableAt(unitType, position)
      const currentlyEnrouteConstructionGrids = getCurrentlyEnrouteConstructionGrids(world);
      const isCurrentlyEnroute = position && pointsOverlap(currentlyEnrouteConstructionGrids, [position]);
      return isPlaceableAt && !isCurrentlyEnroute;
    });
    unsettledBuildingPositions.forEach(([step]) => {
      buildingPositions.delete(step);
    });
  },

  /**
   * Main defense function which determines the defense strategy and actions.
   * @param {World} world - The game world object.
   * @param {UnitTypeId[]} mainCombatTypes - Main combat unit types.
   * @param {UnitTypeId[]} supportUnitTypes - Support unit types.
   * @param {Unit[]} threats - Array of threat units.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of collected actions to execute.
   */
  defend: function (world, mainCombatTypes, supportUnitTypes, threats) {
    console.log('defend');

    const { units } = world.resources.get();
    const rallyPoint = getCombatRally(world.resources);
    const enemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;

    if (!rallyPoint) return [];

    const [combatUnits, supportUnits] = unitService.groupUnits(units, mainCombatTypes, supportUnitTypes);
    let [closestEnemyUnit] = pathFindingService.getClosestUnitByPath(world.resources, rallyPoint, threats);

    if (!closestEnemyUnit || !closestEnemyUnit.pos) return [];

    const workers = units.getById(WorkerRace[world.agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !unitResourceService.isRepairing(unit));

    const [combatPoint] = pathFindingService.getClosestUnitByPath(world.resources, closestEnemyUnit.pos, combatUnits);
    if (!combatPoint) return this.handleNonCombatScenarios(world, closestEnemyUnit, threats);

    let allyUnits = [...combatUnits, ...supportUnits];
    let shouldEngage = armyManagementService.shouldEngage(world, allyUnits, enemyUnits);

    return shouldEngage
      ? handleCombatScenarios(world, allyUnits, closestEnemyUnit, enemyUnits, rallyPoint)
      : this.handleWorkerDefense(world, allyUnits, closestEnemyUnit, workers, threats, rallyPoint);
  },

  /**
   * @description Return unit command to move to the closest position in range of enemy units not in range of enemy attacks.
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit[]} closeAttackableEnemyUnits
   * @param {Unit[]} enemyUnitsInRangeOfTheirAttack
   * @returns {SC2APIProtocol.ActionRawUnitCommand | undefined}
   */
  getCommandToMoveToClosestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks: (world, unit, closeAttackableEnemyUnits, enemyUnitsInRangeOfTheirAttack) => {
    const { data, resources } = world;
    const { pos } = unit; if (pos === undefined) return;
    const positionsInRangeOfEnemyUnits = findPositionsInRangeOfEnemyUnits(world, unit, closeAttackableEnemyUnits);
    const positionsInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks = positionsInRangeOfEnemyUnits.filter(position => !enemyUnitsInRangeOfTheirAttack.some(enemyUnit => isInRangeOfEnemyUnits(data, unit, enemyUnit, position)));
    const [closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks] = pathFindingService.getClosestPositionByPath(resources, pos, positionsInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks);
    if (closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks !== undefined) {
      const [closestPositionInRangeOfEnemyUnits] = pathFindingService.getClosestPositionByPath(resources, pos, positionsInRangeOfEnemyUnits);
      const samePosition = closestPositionInRangeOfEnemyUnits !== undefined && closestPositionInRangeOfEnemyUnits.x === closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks.x && closestPositionInRangeOfEnemyUnits.y === closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks.y;
      let abilityId = samePosition ? ATTACK_ATTACK : MOVE;
      const unitCommand = createUnitCommand(abilityId, [unit]);
      unitCommand.targetWorldSpacePos = samePosition ? closeAttackableEnemyUnits[0].pos : closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks;
      return unitCommand;
    }
  },

  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @param {Alliance} alliance
   * @param {UnitTypeId[]} enemyUnitTypes
   */
  getDPSHealthOfTrainingUnit: (world, unitType, alliance, enemyUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    const { getUnitTypeData } = unitResourceService;
    const { ZERGLING } = UnitType;
    let dPSHealth = 0;
    const unitTypeData = getUnitTypeData(units, unitType);
    if (unitTypeData) {
      const { healthMax, shieldMax } = unitTypeData;
      dPSHealth = getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * (healthMax + shieldMax);
      dPSHealth = unitType === ZERGLING ? dPSHealth * 2 : dPSHealth;
    }
    return dPSHealth;
  },
  /**
   * @param {World} world
   * @returns {number}
   */
  getFoodDifference: (world) => {
    const { agent, data } = world;
    const { race } = agent;
    const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return 0; }
    let { plan, legacyPlan } = planService;
    const { getIdleOrAlmostIdleUnits } = worldService;
    const foodUsed = getFoodUsed();
    const step = plan.find(step => step.food > foodUsed);
    const legacyPlanStep = legacyPlan.find(step => step[0] > foodUsed);
    const foodDifference = ((step && step.food) || (legacyPlanStep && legacyPlanStep[0])) - getFoodUsed();
    const productionUnitsCount = getIdleOrAlmostIdleUnits(world, WorkerRace[race]).length;
    const lowerOfFoodDifferenceAndProductionUnitsCount = Math.min(foodDifference, productionUnitsCount);
    let affordableFoodDifference = 0;
    for (let i = 0; i < lowerOfFoodDifferenceAndProductionUnitsCount; i++) {
      if (agent.canAfford(WorkerRace[agent.race]) && haveSupplyForUnit(world, WorkerRace[agent.race])) {
        affordableFoodDifference++;
        addEarmark(data, data.getUnitTypeData(WorkerRace[agent.race]))
      } else {
        break;
      }
    }
    return affordableFoodDifference;
  },
  /**
   *
   * @param {World} world
   * @param {Unit} unit
   * @returns
   */
  getDPSOfInRangeAntiAirUnits: (world, unit) => {
    const { getWeaponThatCanAttack } = unitService;
    const { data } = world;
    const enemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;
    const { pos, radius, unitType } = unit;
    if (pos === undefined || radius === undefined || unitType === undefined) { return 0 }
    return enemyUnits.reduce((accumulator, enemyUnit) => {
      let dPS = 0;
      const { alliance, pos: enemyPos, radius: enemyRadius, unitType: enemyUnitType } = enemyUnit;
      if (alliance === undefined || enemyPos === undefined || enemyRadius === undefined || enemyUnitType === undefined) { return accumulator }
      const weaponThatCanAttack = getWeaponThatCanAttack(data, enemyUnitType, unit);
      if (weaponThatCanAttack === undefined) { return accumulator }
      const { range } = weaponThatCanAttack;
      if (range === undefined) { return accumulator }
      if (getDistance(pos, enemyPos) <= range + radius + enemyRadius) {
        dPS = getWeaponDPS(world, enemyUnitType, alliance, [unitType]);
      }
      return accumulator + dPS;
    }, 0);
  },

  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {Unit[]}
   */
  getIdleOrAlmostIdleUnits: (world, unitType) => {
    const { getBuildTimeLeft, getPendingOrders } = unitService;
    const { data } = world;

    return unitRetrievalService.getProductionUnits(world, unitType).filter(unit => {
      const { buildProgress, orders } = unit;
      if (!buildProgress || buildProgress < 1) return false;
      if (!orders || orders.length === 0) return getPendingOrders(unit).length === 0;

      const { abilityId, progress } = orders[0]; if (abilityId === undefined || progress === undefined) return false;
      const unitTypeTraining = dataService.unitTypeTrainingAbilities.get(abilityId);
      const unitTypeData = unitTypeTraining && data.getUnitTypeData(unitTypeTraining);

      if (!progress || !unitTypeData) return false;

      const { buildTime } = unitTypeData; if (buildTime === undefined) return false;
      const buildTimeLeft = getBuildTimeLeft(unit, buildTime, progress);
      return buildTimeLeft <= 8 && getPendingOrders(unit).length === 0;
    });
  },
  /**
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {Point2D}
   */
  getPositionVersusTargetUnit: (world, unit, targetUnit) => {
    const { data, resources } = world;
    const totalRadius = unit.radius + targetUnit.radius + 1;
    const range = Math.max.apply(Math, data.getUnitTypeData(unit.unitType).weapons.map(weapon => { return weapon.range; })) + totalRadius;
    if (distance(unit.pos, targetUnit.pos) < range) {
      const corrosiveBileArea = [];
      const RAVAGERCORROSIVEBILECP = 11;
      const corrosiveBileRadius = data.getEffectData(RAVAGERCORROSIVEBILECP).radius;
      resources.get().frame.getEffects().forEach(effect => {
        if (effect.effectId === RAVAGERCORROSIVEBILECP) {
          corrosiveBileArea.push(...gridsInCircle(effect.pos[0], corrosiveBileRadius))
        }
      });
      const outerRangeOfEnemy = gridsInCircle(targetUnit.pos, range).filter(grid => {
        return distance(grid, targetUnit.pos) >= (range - 0.5) && corrosiveBileArea.every(position => distance(position, unit.pos) > corrosiveBileRadius + unit.radius);
      });
      const [closestCandidatePosition] = getClosestPosition(avgPoints(unit['selfUnits'].map((/** @type {Unit} */ unit) => unit.pos)), outerRangeOfEnemy);
      return closestCandidatePosition;
    } else {
      return targetUnit.pos;
    }
  },

  /**
   * @param {Unit[]} canDoTypeUnits
   * @returns {Unit[]}
   */
  getUnitsCanDoWithAddOnAndIdle: (canDoTypeUnits) => {
    return canDoTypeUnits.filter(unit => (unit.hasReactor() || unit.hasTechLab()) && unit.isIdle());
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {import('../interfaces/plan-step').PlanStep | undefined}
   */
  getStep: (world, unitType) => {
    const { resources } = world;
    const { units } = resources.get();
    const { DRONE } = UnitType;
    return planService.plan.find(step => {
      return (
        step.unitType === unitType &&
        step.targetCount === unitRetrievalService.getUnitTypeCount(world, unitType) + (unitType === DRONE ? units.getStructures().length - 1 : 0)
      );
    });
  },

  /**
   * Handle defense scenarios when no combat point is found.
   * @param {World} world - The game world object.
   * @param {Unit} closestEnemyUnit - The closest enemy unit.
   * @param {Unit[]} threats - Array of threatening enemy units.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of actions to execute.
   */
  handleNonCombatScenarios: (world, closestEnemyUnit, threats) => {
    const collectedActions = [];
    const { data, resources } = world;
    const { map, units } = resources.get();

    // Fetching enemy units from the enemyTrackingService
    const enemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;

    // check if any non workers are training
    const unitsTraining = getUnitsTraining(world).filter(unitTraining => unitTraining.unitType !== WorkerRace[world.agent.race]);

    // if not, pull workers to defend
    if (unitsTraining.length === 0 || !canTrainingUnitsKillBeforeKilled(world, unitsTraining.map(unitTraining => unitTraining.unitType), threats)) {
      const workers = units.getById(WorkerRace[world.agent.race])
        .filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !unitResourceService.isRepairing(unit));
      const workerDefenseCommands = this.getWorkerDefenseCommands(world, workers, closestEnemyUnit);
      console.log(`Pulling ${workerDefenseCommands.length} workers to defend with.`);
      collectedActions.push(...workerDefenseCommands);
    } else {
      // this condition is when workers are not needed to defend
      // grab any defending workers and send them back to work
      units.withLabel('defending').forEach(worker => {
        worker.labels.delete('defending');
        const { pos } = worker;
        if (!pos) return;

        const closestEnemyThatCanAttackUnitByWeaponRange = getClosestThatCanAttackUnitByWeaponRange(data, worker, enemyUnits);
        const { enemyUnit } = closestEnemyThatCanAttackUnitByWeaponRange;
        if (!enemyUnit || !enemyUnit.pos) return;

        const unitCommand = createUnitCommand(MOVE, [worker]);
        const closestCandidateMineralField = getClosestSafeMineralField(resources, pos, enemyUnit.pos);
        if (closestCandidateMineralField) {
          unitCommand.abilityId = HARVEST_GATHER;
          unitCommand.targetUnitTag = closestCandidateMineralField.tag;
        } else {
          const movePosition = moveAwayPosition(map, enemyUnit.pos, pos);
          unitCommand.targetWorldSpacePos = movePosition || undefined;
        }
        collectedActions.push(unitCommand);
      });
    }

    return collectedActions;
  },

  /**
   * Handles the defense strategy using workers when primary and support units are not engaging.
   * 
   * @param {World} world - The game world object containing information about the game state.
   * @param {Unit[]} allyUnits - Array of ally combat and support units.
   * @param {Unit} closestEnemyUnit - The closest detected enemy unit.
   * @param {Unit[]} workers - Array of available worker units for defense.
   * @param {Unit[]} threats - Array of potential threat units.
   * @param {Point2D} rallyPoint - The central rallying point for the units.
   * 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of commands for the units to execute for defense.
   */
  handleWorkerDefense: function (world, allyUnits, closestEnemyUnit, workers, threats, rallyPoint) {
    const collectedActions = [];
    const { resources } = world;
    const { units } = resources.get();
    const enemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;

    const inRangeSortedWorkers = closestEnemyUnit.pos
      ? units.getClosest(closestEnemyUnit.pos, workers, workers.length)
        .filter(worker =>
          worker.pos && closestEnemyUnit.pos &&
          distance(worker.pos, closestEnemyUnit.pos) <= 16
        )
      : [];

    let workersToDefend = [];

    for (const worker of inRangeSortedWorkers) {
      workersToDefend.push(worker);
      const allyUnitsWithWorkers = [...allyUnits, ...workersToDefend];
      if (armyManagementService.shouldEngage(world, allyUnitsWithWorkers, threats)) {
        workersToDefend.forEach(worker => worker.labels.set('defending', true));
        break;
      }
    }

    allyUnits = [...allyUnits, ...units.getById(UnitType.QUEEN), ...workersToDefend];
    collectedActions.push(...armyManagementService.engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));

    return collectedActions;
  },

  /**
   * Check if unitType has prerequisites to build when minerals are available.
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {boolean}
   */
  haveAvailableProductionUnitsFor: (world, unitType) => {
    const { resources } = world;
    const { units } = resources.get();
    const warpInAbilityId = WarpUnitAbility[unitType];
    const productionUnits = unitRetrievalService.getProductionUnits(world, unitType);
    return (
      units.getById(WARPGATE).some(warpgate => warpgate.abilityAvailable(warpInAbilityId)) ||
      productionUnits.some(unit =>
        unit.buildProgress !== undefined &&
        unit.buildProgress >= 1 &&
        !unit.isEnemy() &&
        unitTrainingService.canTrainNow(world, unit, unitType)
      )
    );
  },

  /**
   * @param {World} world
   * @returns {number}
   */
  getTrainingPower: (world) => {
    const { resources } = world;
    const trainingUnitTypes = resourceManagerService.getTrainingUnitTypes(resources);
    const { enemyCombatUnits } = enemyTrackingService;
    return trainingUnitTypes.reduce((totalDPSHealth, unitType) => {
      return totalDPSHealth + worldService.getDPSHealthOfTrainingUnit(world, unitType, Alliance.SELF, enemyCombatUnits.map(enemyUnit => enemyUnit.unitType));
    }, 0);
  },
  /**
   * @param {World} world
   * @param {Point2D} position
   * @param {number} range
   * @returns {Unit[]}
   */
  getUnitsInRangeOfPosition: (world, position, range = 16) =>{
    const { units } = world.resources.get();
    const inRangeUnits = units.getCombatUnits(Alliance.SELF).filter(unit => unit.pos && distance(unit.pos, position) <= range);
    return inRangeUnits;
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Unit[]}
   */
  getUnitsTrainingTargetUnitType: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    let { abilityId } = data.getUnitTypeData(unitType);
    if (abilityId === undefined) return [];
    return getUnitsWithCurrentOrders(units, [abilityId]);
  },

  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {number}
   */
  getUnitCount: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const { ZERGLING } = UnitType;
    const { abilityId, attributes } = data.getUnitTypeData(unitType);
    if (abilityId === undefined || attributes === undefined) return 0;
    if (attributes.includes(Attribute.STRUCTURE)) {
      return unitRetrievalService.getUnitTypeCount(world, unitType);
    } else {
      let unitTypes = [];
      if (morphMapping.has(unitType)) {
        // @ts-ignore
        unitTypes = morphMapping.get(unitType);
      } else {
        unitTypes = [unitType];
      }
      // get orders from units with current orders that match the abilityId
      const orders = units.withCurrentOrders(abilityId).reduce((/** @type {SC2APIProtocol.UnitOrder[]} */ matchingOrders, unit) => {
        const { orders } = unit;
        if (orders === undefined) return matchingOrders;
        orders.forEach(order => {
          if (order.abilityId === abilityId) {
            matchingOrders.push(order);
          }
        });
        return matchingOrders;
      }, []);
      const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => u['pendingOrders'] && u['pendingOrders'].some((/** @type {SC2APIProtocol.UnitOrder} */ o) => o.abilityId === abilityId));
      /** @type {SC2APIProtocol.UnitOrder[]} */
      const pendingOrders = unitsWithPendingOrders.map(u => u['pendingOrders']).reduce((a, b) => a.concat(b), []);
      const ordersLength = orders.some(order => order.abilityId === TRAIN_ZERGLING) ? orders.length * 2 : orders.length;
      let pendingOrdersLength = pendingOrders.some(order => order.abilityId === TRAIN_ZERGLING) ? pendingOrders.length * 2 : pendingOrders.length;
      let totalOrdersLength = ordersLength + pendingOrdersLength;
      if (totalOrdersLength > 0) {
        totalOrdersLength = unitType === ZERGLING ? totalOrdersLength - 1 : totalOrdersLength;
      }
      return units.getById(unitTypes).length + totalOrdersLength + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    }
  },
  /**
   * 
   * @param {DataStorage} data 
   * @param {AbilityId[]} abilityIds
   * @returns {UnitTypeId[]}
   */
  getUnitTypesWithAbilities: (data, abilityIds) => {
    const unitTypesWithAbilities = [];
    abilityIds.forEach(abilityId => {
      unitTypesWithAbilities.push(...data.findUnitTypesWithAbility(abilityId));
    });
    return unitTypesWithAbilities;
  },
  /**
   * @param {World} world
   * @returns {void}
   */
  getZergEarlyBuild(world) {
    const { data, resources } = world;
    const { frame, map, units } = resources.get();
    const { ZERGLING } = UnitType;
    const zerglings = enemyTrackingServiceV2.mappedEnemyUnits.filter(unit => unit.unitType === ZERGLING);
    const spawningPool = units.getById(UnitType.SPAWNINGPOOL, { alliance: Alliance.ENEMY }).sort((a, b) => b.buildProgress - a.buildProgress)[0];
    const spawningPoolExists = spawningPool || zerglings.length > 0;
    const spawningPoolStartTime = spawningPool ? frame.timeInSeconds() - dataService.getBuildTimeElapsed(data, spawningPool) : null;
    const enemyNaturalHatchery = map.getEnemyNatural().getBase();
    const enemyNaturalHatcheryStartTime = enemyNaturalHatchery ? frame.timeInSeconds() - dataService.getBuildTimeElapsed(data, enemyNaturalHatchery) : null;
    if (zerglings.length > 0 && !enemyNaturalHatchery) {
      scoutingService.earlyScout = false;
      scoutingService.enemyBuildType = 'cheese';
      scoutService.scoutReport = 'Early scout cancelled. Zerglings detected before natural hatchery scouted.';
    }
    const naturalCommandCenter = map.getNatural().getBase();
    const naturalCommandCenterStartTime = naturalCommandCenter ? frame.timeInSeconds() - dataService.getBuildTimeElapsed(data, naturalCommandCenter) : null;
    const naturalCommandCenterBeforeEnemyNatural = naturalCommandCenter && enemyNaturalHatchery && naturalCommandCenterStartTime < enemyNaturalHatcheryStartTime;
    const { lastSeen } = scoutService;
    if (!spawningPoolExists) {
      if (naturalCommandCenterBeforeEnemyNatural) {
        scoutingService.enemyBuildType = 'cheese';
        scoutingService.scoutReport = `Early scout cancelled: natural command center before enemy natural`;
        if (naturalCommandCenter && enemyNaturalHatchery) {
          scoutingService.earlyScout = false;
        }
        return;
      }
    } else {
      if (spawningPoolStartTime) {
        if (enemyNaturalHatcheryStartTime) {
          if (spawningPoolStartTime < enemyNaturalHatcheryStartTime) {
            scoutingService.enemyBuildType = 'cheese';
            scoutingService.scoutReport = `Early scout cancelled: spawning pool before enemy natural`;
            scoutingService.earlyScout = false;
            return;
          }
        } else {
          if (spawningPoolStartTime < lastSeen['enemyNaturalTownhallFootprint']) {
            scoutingService.enemyBuildType = 'cheese';
            scoutingService.scoutReport = 'Early scout set to false because Spawning Pool start time is less than time enemy natural position was last seen and no enemy natural was found';
            scoutingService.earlyScout = false;
            return;
          }
        }
      }
    }
  },
  /**
  * Halts the current task of the worker.
  * @param {World} world - The current state of the world.
  * @param {Unit} worker - The worker unit whose current task needs to be halted.
  * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
  */
  haltWorker: (world, worker) => {
    // Assuming stop function returns an array of commands, directly return it.
    return worldService.stop([worker]);
  },

  /**
   * @param {World} world 
   * @param {Unit} worker 
   * @param {Unit} targetUnit 
   * @returns {boolean}
   */
  defendWithUnit: (world, worker, targetUnit) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const { pos } = targetUnit; if (pos === undefined) return false;
    const { isRepairing } = unitResourceService;
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy', 'builder']) && !isRepairing(unit));
    const potentialFightersByDistance = pathFindingService.getClosestUnitByPath(resources, pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), [], workers.length);
    const potentialFightersGroupedByHealth = potentialFightersByDistance.reduce((/** @type {[Unit[], Unit[]]} */ groups, fighter) => {
      const { health, healthMax, shield, shieldMax } = fighter; if (health === undefined || healthMax === undefined || shield === undefined || shieldMax === undefined) return groups;
      const healthPercent = (health + shield) / (healthMax + shieldMax);
      if (healthPercent > 0.25) {
        groups[0].push(fighter);
      } else {
        groups[1].push(fighter);
      }
      return groups;
    }, [[], []]);
    const sortedPotentialFightersByDistance = potentialFightersGroupedByHealth[0].concat(potentialFightersGroupedByHealth[1]);
    const targetUnits = getInRangeUnits(targetUnit, enemyTrackingServiceV2.mappedEnemyUnits, 16);
    const fighters = [];
    let timeToKill = 0;
    let timeToDie = 0;
    // get fighters until time to kill is greater than time to die
    for (let i = 0; i < sortedPotentialFightersByDistance.length; i++) {
      const fighter = sortedPotentialFightersByDistance[i];
      fighters.push(fighter);
      timeToKill = getTimeToKill(world, fighters, targetUnits);
      timeToDie = getTimeToKill(world, targetUnits, fighters);
      if ((timeToKill * 1.1) < timeToDie) break;
    }
    return fighters.some(fighter => fighter.tag === worker.tag);
  },

  /**
   * @param {World} world
   * @param {Unit[]} workers
   * @param {Unit} closestEnemyUnit
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  getWorkerDefenseCommands: (world, workers, closestEnemyUnit) => {
    const resources = world.resources;
    const { units } = resources.get();
    const stopFunction = unitService.stop;
    const getWorkersToDefendFunction = worldService.getWorkersToDefend;
    const microBFunction = worldService.microB;

    const enemyUnits = units.getAlive(Alliance.ENEMY);

    // Stopping workers that are not defending
    const stopActions = workers
      .filter(worker => worker.labels.get('defending') === false)
      .map(worker => {
        worker.labels.delete('defending');
        return stopFunction([worker]);
      })
      .flat();

    const workersToDefend = getWorkersToDefendFunction(world, workers, closestEnemyUnit);

    console.log(`Pulling ${workersToDefend.length} to defend with.`);

    // Generating defense commands for workers that should defend
    const defendActions = workersToDefend
      .map(worker => microBFunction(world, worker, closestEnemyUnit, enemyUnits))
      .flat();

    return [...stopActions, ...defendActions];
  },
  /**
   * @param {World} world
   * @param {Unit[]} workers
   * @param {Unit} closestEnemyUnit
   * @returns {Unit[]}
   */
  getWorkersToDefend: (world, workers, closestEnemyUnit) => {
    const { defendWithUnit } = worldService;
    const { pos } = closestEnemyUnit; if (pos === undefined) return [];
    const workersToDefend = workers.reduce((/** @type {Unit[]} */ acc, worker) => {
      const { pos: workerPos } = worker; if (workerPos === undefined) return acc;
      const distanceToClosestEnemy = distance(workerPos, pos);
      const isLoneWorkerAndOutOfRange = closestEnemyUnit.isWorker() && closestEnemyUnit['selfUnits'].length === 1 && distanceToClosestEnemy > 8;
      const isAttackable = canAttack(worker, closestEnemyUnit);
      if (isLoneWorkerAndOutOfRange || !isAttackable) return acc;
      if (defendWithUnit(world, worker, closestEnemyUnit)) {
        acc.push(worker);
        worker.labels.set('defending', true);
      } else {
        if (worker.isAttacking() && worker.labels.has('defending')) {
          worker.labels.set('defending', false);
        }
      }
      return acc;
    }, []);
    return workersToDefend;
  },

  /**
   * @param {World} world
   * @param {Unit} unit
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  micro: (world, unit) => {
    const { getCommandToMoveToClosestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks } = worldService;
    const { data, resources } = world;
    const collectedActions = [];
    const { pos, radius } = unit; if (pos === undefined || radius === undefined) { return collectedActions; }
    const enemyUnits = enemyTrackingServiceV2.mappedEnemyUnits;
    const closestEnemyThatCanAttackUnitByWeaponRange = getClosestThatCanAttackUnitByWeaponRange(data, unit, enemyUnits);
    const { enemyUnit } = closestEnemyThatCanAttackUnitByWeaponRange; if (enemyUnit === undefined) { return collectedActions; }
    if (shouldMicro(data, unit, enemyUnit)) {
      const unitCommand = createUnitCommand(MOVE, [unit]);
      const positions = findPositionsInRangeOfEnemyUnits(world, unit, [enemyUnit]);
      const closestPosition = positions.reduce((/** @type {{ distance: number, position: Point2D | undefined }} */ acc, position) => {
        const distanceToPosition = getDistance(position, pos);
        if (distanceToPosition < acc.distance) {
          return { distance: distanceToPosition, position };
        }
        return acc;
      }, { distance: Infinity, position: undefined });
      const { position: closestPositionInRange } = closestPosition; if (closestPositionInRange === undefined) return collectedActions;
      collectedActions.push(unitCommand);
    } else {
      const inRangeAttackableEnemyUnits = getInRangeAttackableEnemyUnits(data, unit, enemyUnits);
      const enemyUnitsInRangeOfTheirAttack = getEnemyUnitsInRangeOfTheirAttack(data, unit, enemyUnits);
      if (inRangeAttackableEnemyUnits.length === 0) {
        const attackableEnemyUnits = enemyUnits.filter(enemyUnit => canAttack(unit, enemyUnit));
        const closeAttackableEnemyUnits = attackableEnemyUnits.filter(enemyUnit => enemyUnit.pos && pathFindingService.getDistanceByPath(resources, pos, enemyUnit.pos) <= 16);
        if (closeAttackableEnemyUnits.length > 0) {
          const unitCommand = getCommandToMoveToClosestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks(world, unit, closeAttackableEnemyUnits, enemyUnitsInRangeOfTheirAttack);
          if (unitCommand !== undefined) collectedActions.push(unitCommand);
        }
        if (collectedActions.length === 0) {
          const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
          unitCommand.targetWorldSpacePos = enemyUnit.pos;
          collectedActions.push(unitCommand);
        }
      } else {
        const [weakestInRangeAttackableEnemyUnit] = inRangeAttackableEnemyUnits.sort((a, b) => {
          const { health: aHealth, shield: aShield } = a; if (aHealth === undefined || aShield === undefined) { return 1; }
          const { health: bHealth, shield: bShield } = b; if (bHealth === undefined || bShield === undefined) { return -1; }
          return (aHealth + aShield) - (bHealth + bShield);
        });
        if (weakestInRangeAttackableEnemyUnit !== undefined) {
          const { pos: weakestInRangeAttackableEnemyUnitPos } = weakestInRangeAttackableEnemyUnit; if (weakestInRangeAttackableEnemyUnitPos === undefined) { return collectedActions; }
          const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
          unitCommand.targetUnitTag = weakestInRangeAttackableEnemyUnit.tag;
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {Unit[]} enemyUnits 
   * @returns 
   */
  microB: (world, unit, targetUnit, enemyUnits) => {
    const { ADEPTPHASESHIFT } = UnitType;
    const { resources } = world;
    const { map } = resources.get();
    const collectedActions = [];
    const { pos, health, radius, shield, tag, unitType, weaponCooldown } = unit;
    if (pos === undefined || health === undefined || radius === undefined || shield === undefined || tag === undefined || unitType === undefined || weaponCooldown === undefined) { return collectedActions; }
    const { pos: targetPos, health: targetHealth, radius: targetRadius, shield: targetShield, unitType: targetUnitType } = targetUnit;
    if (targetPos === undefined || targetHealth === undefined || targetRadius === undefined || targetShield === undefined || targetUnitType === undefined) { return collectedActions; }
    const retreatCommand = createUnitCommand(MOVE, [unit]);
    if (unit.isWorker()) {
      // describe the logic block below
      // get worker retreat position
      let closestCandidateMineralField = getClosestSafeMineralField(resources, pos, targetPos);       
      if (closestCandidateMineralField !== undefined) {
        retreatCommand.abilityId = HARVEST_GATHER;
        retreatCommand.targetUnitTag = closestCandidateMineralField.tag;
      } else {
        const awayPos = moveAwayPosition(map, targetPos, pos);
        if (awayPos !== null) {
          retreatCommand.targetWorldSpacePos = awayPos;
        }
      }
    } else {
      const awayPos = moveAwayPosition(map, targetPos, pos);
      if (awayPos !== null) {
        retreatCommand.targetWorldSpacePos = awayPos;
      }
    }
    const meleeTargetsInRangeFacing = enemyUnits.filter(enemyUnit => {
      const { pos: enemyPos, radius: enemyRadius } = enemyUnit; if (enemyPos === undefined || enemyRadius === undefined) { return false; }
      const meleeTargetInRangeFacing = (
        enemyUnit.isMelee() &&
        (distance(pos, enemyPos) + 0.05) - (radius + enemyRadius) < 0.5 &&
        microService.isFacing(targetUnit, unit)
      );
      return meleeTargetInRangeFacing;
    });
    const targetUnitsWeaponDPS = meleeTargetsInRangeFacing.reduce((acc, meleeTargetInRangeFacing) => {
      const { unitType: meleeTargetInRangeFacingUnitType } = meleeTargetInRangeFacing; if (meleeTargetInRangeFacingUnitType === undefined) { return acc; }
      return acc + getWeaponDPS(world, meleeTargetInRangeFacingUnitType, Alliance.ENEMY, [unitType]);
    }, 0);
    const totalUnitHealth = health + shield;
    const timeToBeKilled = totalUnitHealth / targetUnitsWeaponDPS * 22.4;
    if (
      meleeTargetsInRangeFacing.length > 0 &&
      (weaponCooldown > 8 || timeToBeKilled < 24)
    ) {
      console.log('unit.weaponCooldown', unit.weaponCooldown);
      console.log('distance(unit.pos, targetUnit.pos)', distance(pos, targetPos));
      collectedActions.push(retreatCommand);
    } else {
      const inRangeMeleeEnemyUnits = enemyUnits.filter(enemyUnit => enemyUnit.isMelee() && ((distance(pos, enemyUnit.pos) + 0.05) - (radius + enemyUnit.radius) < 0.25));
      const [weakestInRange] = inRangeMeleeEnemyUnits.sort((a, b) => (a.health + a.shield) - (b.health + b.shield));
      targetUnit = weakestInRange || targetUnit;
      /** @type {SC2APIProtocol.ActionRawUnitCommand} */
      const unitCommand = {
        abilityId: ATTACK_ATTACK,
        unitTags: [tag],
      }
      if (targetUnit.unitType === ADEPTPHASESHIFT) {
        unitCommand.targetWorldSpacePos = targetUnit.pos;
      } else {
        unitCommand.targetUnitTag = targetUnit.tag;
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },

  /**
   * @param {World} world 
   * @param {Unit} worker 
   * @param {Unit} targetUnit 
   * @param {Unit[]} enemyUnits 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  pullWorkersToDefend: (world, worker, targetUnit, enemyUnits) => {
    const { mineralFieldTypes } = groupTypes;
    const { isRepairing } = unitResourceService;
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const inRangeEnemySupply = calculateHealthAdjustedSupply(world, getInRangeUnits(targetUnit, [...enemyTrackingServiceV2.mappedEnemyUnits]));
    const amountToFightWith = Math.ceil(inRangeEnemySupply / data.getUnitTypeData(WorkerRace[agent.race]).foodRequired);
    const workers = units.getById(WorkerRace[agent.race]).filter(worker => {
      return (
        filterLabels(worker, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy', 'builder']) &&
        !isRepairing(worker) &&
        !worker.isReturning()
      );
    });
    const fighters = units.getClosest(targetUnit.pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), amountToFightWith);
    if (fighters.find(fighter => fighter.tag === worker.tag)) {
      const candidateMinerals = units.getByType(mineralFieldTypes).filter(mineralField => distance(worker.pos, mineralField.pos) < distance(targetUnit.pos, mineralField.pos));
      const [closestCandidateMineral] = units.getClosest(worker.pos, candidateMinerals);
      if (closestCandidateMineral) {
        collectedActions.push(...worldService.microB(world, worker, targetUnit, enemyUnits));
      }
    } else if (worker.isAttacking() && worker.orders.find(order => order.abilityId === ATTACK_ATTACK).targetUnitTag === targetUnit.tag) {
      collectedActions.push(...gatherOrMine(resources, worker));
    }
    return collectedActions;
  },
  /**
   * Directs combat and support units to engage or retreat based on the closest enemy target. 
   * Also handles scanning cloaked enemies.
   *
   * @param {World} world - The game world.
   * @param {UnitTypeId} mainCombatTypes - The types of main combat units.
   * @param {UnitTypeId} supportUnitTypes - The types of support units.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The collected actions for units.
   */
  push: (world, mainCombatTypes, supportUnitTypes) => {
    const { searchAndDestroy } = resourceManagerService;
    const { groupUnits } = unitService;
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];

    let [closestEnemyBase] = pathFindingService.getClosestUnitByPath(
      resources,
      getCombatRally(resources),
      units.getBases(Alliance.ENEMY)
    );

    const [combatUnits, supportUnits] = groupUnits(units, [mainCombatTypes], [supportUnitTypes]);

    // No need to re-group units, use the previously grouped units
    if (!combatUnits.length) {
      return [];
    }

    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    const closestEnemyTarget = closestEnemyBase
      || pathFindingService.getClosestUnitByPath(resources, avgCombatUnitsPoint, enemyTrackingServiceV2.mappedEnemyUnits)[0];

    if (closestEnemyTarget && closestEnemyTarget.pos) {
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyTarget, combatUnits));

      const allyUnits = [
        ...combatUnits,
        ...supportUnits,
        ...units.getWorkers().filter(worker => worker.isAttacking())
      ];

      const selfDPSHealth = allyUnits.reduce((accumulator, unit) => {
        const enemyTypes = enemyTrackingServiceV2.mappedEnemyUnits.reduce((typesAccumulator, enemyUnit) => {
          typesAccumulator.add(enemyUnit.unitType);
          return typesAccumulator;
        }, new Set());

        return accumulator + getDPSHealth(world, unit, Array.from(enemyTypes));
      }, 0);

      console.log('Push', selfDPSHealth, closestEnemyTarget['selfDPSHealth']);

      collectedActions.push(
        ...armyManagementService.engageOrRetreat(world, allyUnits, enemyTrackingServiceV2.mappedEnemyUnits, closestEnemyTarget.pos, false)
      );

      collectedActions.push(...scanCloakedEnemy(units, closestEnemyTarget, combatUnits));
    } else {
      collectedActions.push(...searchAndDestroy(resources, combatUnits, supportUnits));
    }

    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {Point2D} position
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  rallyWorkerToTarget: (world, position, mineralTarget = false) => {
    const { rallyWorkersAbilities } = groupTypes;
    const { getPendingOrders, setPendingOrders } = unitService;
    const { getNeediestMineralField } = unitResourceService;
    const { data, resources } = world;
    const { units } = resources.get();
    const { DRONE, EGG } = UnitType;
    const collectedActions = [];
    const workerSourceByPath = worldService.getWorkerSourceByPath(world, position);

    if (!workerSourceByPath) return collectedActions;

    const { orders, pos } = workerSourceByPath;
    if (pos === undefined) return collectedActions;

    if (getPendingOrders(workerSourceByPath).some(order => order.abilityId && order.abilityId === SMART)) return collectedActions;

    let rallyAbility = null;
    if (workerSourceByPath.unitType === EGG) {
      rallyAbility = orders.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? RALLY_BUILDING : null;
    } else {
      rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
    }

    if (!rallyAbility) return collectedActions;

    const unitCommand = createUnitCommand(SMART, [workerSourceByPath]);
    if (mineralTarget) {
      const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(pos, mineralField.pos) < 14);
      const neediestMineralField = getNeediestMineralField(units, mineralFields);
      if (neediestMineralField === undefined) return collectedActions;
      unitCommand.targetUnitTag = neediestMineralField.tag;
    } else {
      unitCommand.targetWorldSpacePos = position;
    }

    collectedActions.push(unitCommand);
    setPendingOrders(workerSourceByPath, unitCommand);

    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  repositionBuilding: (world) => {
    const { setPendingOrders } = unitService;
    const { landingAbilities, liftingAbilities } = groupTypes;
    const { data, resources } = world;
    const { map, units } = resources.get();
    const repositionUnits = units.withLabel('reposition');

    let collectedActions = [];

    /**
     * @param {AbilityId} ability
     * @param {Unit} unit
     * @param {Point2D | null} targetPos
     * @returns {void}
     */
    function storeUnitCommand(ability, unit, targetPos = null) {
      const unitCommand = createUnitCommand(ability, [unit]);
      if (targetPos) {
        unitCommand.targetWorldSpacePos = targetPos;
      }
      collectedActions.push(unitCommand);
      setPendingOrders(unit, unitCommand);
    }

    collectedActions = repositionUnits.reduce((/** @type {SC2APIProtocol.ActionRawUnitCommand[]} */ actions, unit) => {
      const { orders, pos, unitType } = unit;
      if (orders === undefined || pos === undefined || unitType === undefined) return actions;

      const unitAbilities = unit.availableAbilities();
      const repositionState = unit.labels.get('reposition');
      const addOnTag = unit.addOnTag;
      const addOn = addOnTag !== undefined ? units.getByTag(addOnTag) : null;

      if (unitAbilities.some(ability => liftingAbilities.includes(ability)) && !unit.labels.has('pendingOrders')) {
        if (repositionState === 'lift') {
          storeUnitCommand(Ability.LIFT, unit);
        } else {
          if (distance(pos, repositionState) > 1) {
            storeUnitCommand(Ability.LIFT, unit);
          } else {
            unit.labels.delete('reposition');
            if (addOn) {
              addOn.labels.delete('reposition');
            }
          }
        }
      }

      if (unitAbilities.some(ability => landingAbilities.includes(ability))) {
        if (repositionState === 'lift') {
          unit.labels.delete('reposition');
          if (addOn && addOn.labels) {
            addOn.labels.delete('reposition');
          }
        } else {
          const unitTypeOfFlyingBuilding = flyingTypesMapping.get(unitType);
          if (!unitTypeOfFlyingBuilding || !map.isPlaceableAt(unitTypeOfFlyingBuilding, repositionState)) {
            storeUnitCommand(MOVE, unit);
          } else {
            storeUnitCommand(Ability.LAND, unit, repositionState);
          }
        }
      }

      // delete reposition label for addOns that have a building that has it as an addOn
      units.getStructures().forEach(structure => {
        const addOnTag = structure.addOnTag;
        const addOn = addOnTag !== undefined ? units.getByTag(addOnTag) : null;
        if (addOn && addOn.labels && addOn.labels.has('reposition')) {
          addOn.labels.delete('reposition');
        }
      });

      // cancel training orders
      if (dataService.isTrainingUnit(data, unit)) {
        orders.forEach(() => {
          storeUnitCommand(CANCEL_QUEUE5, unit);
        });
      }

      return collectedActions;
    }, []);

    return collectedActions;
  },

  /**
   * @param {World} world 
   * @param {UnitTypeId[]} candidateTypesToBuild 
   * @returns {UnitTypeId}
   */
  selectTypeToBuild(world, candidateTypesToBuild) {
    const { agent, data } = world;
    const { vespene } = agent; if (vespene === undefined) return candidateTypesToBuild[0];
    const filteredTypes = candidateTypesToBuild.filter(type => {
      const { vespeneCost } = data.getUnitTypeData(type); if (vespeneCost === undefined) return true;
      return vespene > 170 || vespeneCost === 0;
    });
    return filteredTypes[Math.floor(Math.random() * filteredTypes.length)];
  },
  /**
   * @param {World} world
   * @param {SC2APIProtocol.PlayerResult} selfResult
   */
  saveBuildOrder: (world, selfResult) => {
    const { agent } = world;
    let selfRace = RaceId[agent.race];
    let opponentRace = RaceId[scoutService.opponentRace];
    console.log('__dirname', __dirname);
    const plans = JSON.parse(fs.readFileSync(
      // path.join(__dirname, '../', 'data', `plans.json`)).toString()
      path.join(__dirname, 'data', `plans.json`)).toString()
    ) || {};
    if (!plans[selfRace]) {
      plans[selfRace] = {};
    }
    if (!plans[selfRace][opponentRace]) {
      plans[selfRace][opponentRace] = {};
    }
    const executedSteps = loggingService.executedSteps.map(step => {
      const convertedStep = [
        step[0],
        step[2],
      ];
      if (step[7]) {
        convertedStep.push(step[7]);
      }
      return convertedStep;
    });
    if (!plans[selfRace][opponentRace][planService.uuid]) {
      plans[selfRace][opponentRace][planService.uuid] = {};
      plans[selfRace][opponentRace][planService.uuid]['result'] = {wins: 0, losses: 0};
    }
    plans[selfRace][opponentRace][planService.uuid]['orders'] = executedSteps;
    if (selfResult.result === 1) {
      plans[selfRace][opponentRace][planService.uuid]['result'].wins++;
    } else {
      plans[selfRace][opponentRace][planService.uuid]['result'].losses++;
    }
    plans[selfRace][opponentRace][planService.uuid]['attackFood'] = foodUsedService.minimumAmountToAttackWith;
    fs.writeFileSync(
      // path.join(__dirname, '../', 'data', `plans.json`),
      path.join(__dirname, 'data', `plans.json`),
      JSON.stringify(plans, null, 2)
    );
  },
  /**
   * @param {World} world
   * @param {Unit[]} units
   * @param {Unit[]} enemyUnits 
   * @returns {void}
   */
  setEnemyDPSHealthPower: (world, units, enemyUnits) => {
    const { resources } = world;
    const { map } = resources.get();
    units.forEach(unit => {
      unit['enemyUnits'] = setUnitsProperty(map, unit, enemyUnits);
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['enemyDPSHealth'] = calculateNearDPSHealth(world, unit['enemyUnits'], (closestEnemyUnit && closestEnemyUnit['selfUnits']) ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },

  /**
   * Sets list of selfUnits and calculates DPSHealth for selfUnits within a 16 distance range.
   * @param {World} world 
   * @param {Unit[]} units
   * @param {Unit[]} enemyUnits
   * @returns {void}
   */
  setSelfDPSHealthPower: (world, units, enemyUnits) => {
    // get array of unique unitTypes from enemyUnits
    const { resources } = world;
    const { map } = resources.get();
    units.forEach(unit => {
      unit['selfUnits'] = setUnitsProperty(map, unit, units);
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['selfDPSHealth'] = calculateNearDPSHealth(world, unit['selfUnits'], closestEnemyUnit ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },
  /**
   * @param {World} world 
   */
  setTotalEnemyDPSHealth: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const selfCombatUnits = [...units.getCombatUnits(), ...units.getById(UnitType.QUEEN)];
    const { enemyCombatUnits } = enemyTrackingService;
    worldService.totalEnemyDPSHealth = enemyCombatUnits.reduce((totalDPSHealth, unit) => {
      /** @type {UnitTypeId[]} */
      // @ts-ignore
      const unitTypes = [...selfCombatUnits.map(selfCombatUnit => selfCombatUnit.unitType), ...resourceManagerService.getTrainingUnitTypes(resources)].filter((unitType => unitType !== undefined));
      return totalDPSHealth + calculateNearDPSHealth(world, [unit], unitTypes);
    }, 0);
  },
  /**
   * @param {World} world 
   */
  setTotalSelfDPSHealth: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const selfCombatUnits = [...units.getCombatUnits(), ...units.getById(UnitType.QUEEN)];
    const { enemyCombatUnits } = enemyTrackingService;
    worldService.totalSelfDPSHealth = selfCombatUnits.reduce((totalDPSHealth, unit) => {
      return totalDPSHealth + calculateNearDPSHealth(world, [unit], enemyCombatUnits.map(enemyCombatUnit => enemyCombatUnit.unitType));
    }, 0);
    worldService.totalSelfDPSHealth += resourceManagerService.getTrainingUnitTypes(resources).reduce((totalDPSHealth, unitType) => {
      return totalDPSHealth + worldService.calculateDPSHealthOfTrainingUnits(world, [unitType], Alliance.SELF, enemyCombatUnits);
    }, 0);
  },    
  /**
   * @param {World} world 
   * @param {[]} conditions 
   */
  swapBuildings: async (world, conditions = []) => {
    const { addonTypes } = groupTypes;
    // get first building, if addon get building offset
    const { units } = world.resources.get();
    const label = 'swapBuilding';
    let buildingsToSwap = [...conditions].map((condition, index) => {
      const addOnValue = `addOn${index}`;
      const unitType = condition[0];
      let [building] = units.withLabel(label).filter(unit => unit.labels.get(label) === index);
      if (!worldService.checkBuildingCount(world, unitType, condition[1]) && !building) { return }
      let [addOn] = units.withLabel(label).filter(unit => unit.labels.get(label) === addOnValue);
      if (!building) {
        if (addonTypes.includes(unitType)) {
          [addOn] = addOn ? [addOn] : units.getById(unitType).filter(unit => unit.buildProgress >= 1);
          const [building] = addOn ? units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures()) : [];
          if (addOn && building) {
            addOn.labels.set(label, addOnValue);
            return building;
          }
        } else {
          const [building] = units.getById(countTypes.get(unitType)).filter(unit => unit.noQueue && (unit.addOnTag === '0' || parseInt(unit.addOnTag) === 0) && unit.buildProgress >= 1);
          if (building) {
            return building;
          }
        }
      } else {
        return building;
      }
    });
    if (buildingsToSwap.every(building => building)) {
      buildingsToSwap[0].labels.set(label, buildingsToSwap[1].pos);
      buildingsToSwap[1].labels.set(label, buildingsToSwap[0].pos);
    }
  },

  /**
   * @param {World} world
   * @returns {Boolean}
   */
  shortOnWorkers: (world) => {
    const { gasMineTypes, townhallTypes } = groupTypes;
    const { agent, resources } = world;
    const { map, units } = resources.get();
    let idealHarvesters = 0
    let assignedHarvesters = 0
    const mineralCollectors = [...units.getBases(), ...getById(resources, gasMineTypes)];
    mineralCollectors.forEach(mineralCollector => {
      const { buildProgress, assignedHarvesters: assigned, idealHarvesters: ideal, unitType } = mineralCollector;
      if (buildProgress === undefined || assigned === undefined || ideal === undefined || unitType === undefined) return;
      if (buildProgress === 1) {
        assignedHarvesters += assigned;
        idealHarvesters += ideal;
      } else {
        if (townhallTypes.includes(unitType)) {
          const { pos: townhallPos } = mineralCollector; if (townhallPos === undefined) return false;
          if (map.getExpansions().some(expansion => getDistance(expansion.townhallPosition, townhallPos) < 1)) {
            let mineralFields = [];
            if (!mineralCollector.labels.has('mineralFields')) {
              mineralFields = units.getMineralFields().filter(mineralField => {
                const { pos } = mineralField; if (pos === undefined) return false;
                if (distance(pos, townhallPos) < 16) {
                  const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, townhallPos)
                  const { pathablePosition, pathableTargetPosition } = closestPathablePositionBetweenPositions;
                  const distanceByPath = pathFindingService.getDistanceByPath(resources, pathablePosition, pathableTargetPosition);
                  return distanceByPath <= 16;
                } else {
                  return false;
                }
              });
              mineralCollector.labels.set('mineralFields', mineralFields);
            }
            mineralFields = mineralCollector.labels.get('mineralFields');
            idealHarvesters += mineralFields.length * 2 * buildProgress;
          }
        } else {
          idealHarvesters += 3 * buildProgress;
        }
      }
    });
    // count workers that are training
    const unitsTrainingTargetUnitType = worldService.getUnitsTrainingTargetUnitType(world, WorkerRace[agent.race]);
    return idealHarvesters > (assignedHarvesters + unitsTrainingTargetUnitType.length);
  },

  /**
   * @param {World} world
   * @param {Point2D} position
   * @returns {Unit}
   */
  getWorkerSourceByPath: (world, position) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const { EGG } = UnitType;

    let unitList;
    if (agent.race === Race.ZERG) {
      unitList = armyManagementService.getUnitsFromClustering(units.getById(EGG));
    } else {
      unitList = armyManagementService.getUnitsFromClustering(units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1));
    }

    const [closestUnitByPath] = pathFindingService.getClosestUnitByPath(resources, position, unitList);
    return closestUnitByPath;
  }
}

module.exports = worldService;

/**
 * @param {MapResource} map
 * @param {Unit} unit
 * @param {Unit[]} units
 * @returns {Unit[]}
 */
function setUnitsProperty(map, unit, units) {
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return [];
  return units.filter(toFilterUnit => {
    const { pos: toFilterUnitPos, radius: toFilterUnitRadius } = toFilterUnit; if (toFilterUnitPos === undefined || toFilterUnitRadius === undefined) return false;
    const { weapons } = toFilterUnit.data(); if (weapons === undefined) return false;
    const weaponRange = weapons.reduce((acc, weapon) => {
      if (weapon.range === undefined) return acc;
      return weapon.range > acc ? weapon.range : acc;
    }, 0);
    
    return distance(pos, toFilterUnitPos) <= weaponRange + radius + toFilterUnitRadius + getTravelDistancePerStep(map, toFilterUnit) + getTravelDistancePerStep(map, unit);
  });
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 */
function haveSupplyForUnit(world, unitType) {
  const { agent, data } = world;
  const { foodCap } = agent; if (foodCap === undefined) return false;
  const foodUsed = getFoodUsed();
  const earmarkedFood = dataService.getEarmarkedFood();
  const { foodRequired } = data.getUnitTypeData(unitType); if (foodRequired === undefined) return false;
  const supplyLeft = foodCap - foodUsed - earmarkedFood - foodRequired;
  return supplyLeft >= 0;
}

/**
 * @param {DataStorage} data 
 * @param {Unit} unit 
 * @param {Unit[]} enemyUnits 
 * @returns {{ distance: number, enemyUnit: Unit | undefined }}
 */
function getClosestThatCanAttackUnitByWeaponRange(data, unit, enemyUnits) {
  const { getWeaponThatCanAttack } = unitService;
  const { pos: unitPos, radius: unitRadius, unitType: unitType } = unit;

  // If essential properties are missing, return early
  if (unitPos === undefined || unitRadius === undefined || unitType === undefined) {
    return { distance: Infinity, enemyUnit: undefined };
  }

  // Iterate through enemy units to find closest that our unit can attack
  return enemyUnits.reduce((/** @type {{ distance: number, enemyUnit: Unit | undefined }} */ closest, enemyUnit) => {
    const { pos: enemyPos, radius: enemyRadius, unitType: enemyType } = enemyUnit;

    // Skip if essential enemy properties are missing
    if (enemyPos === undefined || enemyRadius === undefined || enemyType === undefined) {
      return closest;
    }

    // Calculate initial distance between our unit and the enemy
    let distanceToEnemy = getDistance(unitPos, enemyPos) - unitRadius - enemyRadius;

    // Check if the enemy can be attacked by our unit
    const weaponThatCanAttackEnemy = getWeaponThatCanAttack(data, enemyType, unit);
    if (weaponThatCanAttackEnemy !== undefined) {
      const { range } = weaponThatCanAttackEnemy;
      if (range === undefined) {
        return closest;
      }
      distanceToEnemy -= range;
    }
    // If the enemy is a flying unit and our unit can attack air, check for a weapon
    else if (enemyUnit.isFlying && unit.canShootUp()) {
      const weapon = getWeaponThatCanAttack(data, unitType, enemyUnit);
      if (weapon !== undefined) {
        const { range } = weapon;
        if (range !== undefined) {
          distanceToEnemy -= range;
        }
      }
    }
    // If our unit can't attack the enemy, skip to the next
    else {
      return closest;
    }

    // If the enemy is closer than the previous closest, update
    if (distanceToEnemy < closest.distance) {
      return { distance: distanceToEnemy, enemyUnit };
    }

    return closest;
  }, { distance: Infinity, enemyUnit: undefined });
}

/**
 * @description Returns the enemy units that are in range of the unit's weapons.
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit[]}
 */
function getInRangeAttackableEnemyUnits(data, unit, enemyUnits) {
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit; if (pos === undefined || radius === undefined || unitType === undefined) return [];
  return enemyUnits.filter(enemyUnit => {
    const { pos: enemyUnitPos, radius: enemyUnitRadius } = enemyUnit; if (enemyUnitPos === undefined || enemyUnitRadius === undefined) { return false; }
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, enemyUnit); if (weaponThatCanAttack === undefined) { return false; }
    const { range } = weaponThatCanAttack; if (range === undefined) { return false; }
    return getDistance(pos, enemyUnitPos) <= range + radius + enemyUnitRadius;
  });
}

/**
 * @description Returns the enemy units whose weapons are in range of the unit.
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit[]}
 */
function getEnemyUnitsInRangeOfTheirAttack(data, unit, enemyUnits) {
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit; if (pos === undefined || radius === undefined || unitType === undefined) return [];
  return enemyUnits.filter(enemyUnit => {
    const { pos: enemyUnitPos, radius: enemyUnitRadius, unitType: enemyUnitType } = enemyUnit; if (enemyUnitPos === undefined || enemyUnitRadius === undefined || enemyUnitType === undefined) { return false; }
    const weaponThatCanAttack = getWeaponThatCanAttack(data, enemyUnitType, unit); if (weaponThatCanAttack === undefined) { return false; }
    const { range } = weaponThatCanAttack; if (range === undefined) { return false; }
    return getDistance(pos, enemyUnitPos) <= range + radius + enemyUnitRadius;
  });
}

/**
 * @description Returns positions that are in range of the unit's weapons from enemy units.
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Point2D[]}
 */
function findPositionsInRangeOfEnemyUnits(world, unit, enemyUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { enemyUnitsPositions } = enemyTrackingService;
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit; if (pos === undefined || radius === undefined || unitType === undefined) return [];
  return enemyUnits.reduce((/** @type {Point2D[]} */ acc, enemyUnit) => {
    const { pos: enemyUnitPos, radius: enemyUnitRadius, tag, unitType: enemyUnitType } = enemyUnit;
    if (enemyUnitPos === undefined || enemyUnitRadius === undefined || tag === undefined || enemyUnitType === undefined) { return acc; }
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, enemyUnit); if (weaponThatCanAttack === undefined) { return acc; }
    const { range } = weaponThatCanAttack; if (range === undefined) { return acc; }
    const targetPositions = enemyUnitsPositions.get(tag);
    if (targetPositions === undefined) {
      const pointsInRange = getPointsInRange(enemyUnitPos, range + radius + enemyUnitRadius);
      acc.push(...pointsInRange);
      return acc;
    }
    const projectedEnemyUnitPos = getProjectedPosition(targetPositions.current.pos, targetPositions.previous.pos, targetPositions.current.lastSeen, targetPositions.previous.lastSeen);
    const pointsInRange = getPointsInRange(projectedEnemyUnitPos, range + radius + enemyUnitRadius);
    const pathablePointsInRange = pointsInRange.filter(point => map.isPathable(point));
    acc.push(...pathablePointsInRange);
    return acc;
  }, []);
}

/**
 * @description Returns boolean if the unit is in range of the enemy unit's weapons.
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit} enemyUnit
 * @param {Point2D} position
 * @returns {boolean}
 */
function isInRangeOfEnemyUnits(data, unit, enemyUnit, position) {
  const { getWeaponThatCanAttack } = unitService;
  const { radius, unitType } = unit; if (radius === undefined || unitType === undefined) return false;
  const { pos: enemyUnitPos, radius: enemyUnitRadius, unitType: enemyUnitType } = enemyUnit; if (enemyUnitPos === undefined || enemyUnitRadius === undefined || enemyUnitType === undefined) { return false; }
  const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, enemyUnit); if (weaponThatCanAttack === undefined) { return false; }
  const { range } = weaponThatCanAttack; if (range === undefined) { return false; }
  return getDistance(position, enemyUnitPos) <= range + radius + enemyUnitRadius;
}

/**
 * @description Returns boolean if the unit is in range of the enemy unit's weapons.
 * @param {Point2D} position
 * @param {number} range
 * @returns {Point2D[]}
 */
function getPointsInRange(position, range) {
  const { x, y } = position; if (x === undefined || y === undefined) return [];
  // get points around enemy unit that are in range of the unit's weapons, at least 16 points
  const pointsInRange = [];
  for (let i = 0; i < 16; i++) {
    const angle = i * 2 * Math.PI / 16;
    const point = {
      x: x + range * Math.cos(angle),
      y: y + range * Math.sin(angle),
    };
    pointsInRange.push(point);
  }
  return pointsInRange;
}

/**
 * @description calculates the time it takes to kill the target unit
 * @param {World} world
 * @param {Unit[]} fighters
 * @param {Unit[]} targetUnits
 * @returns {number}
 */
function getTimeToKill(world, fighters, targetUnits) {
  // get the time it takes to kill target units by all fighters
  const fightersDPS = fighters.reduce((acc, fighter) => {
    // keep dps of each fighter for next iteration
    const { unitType, alliance } = fighter; if (unitType === undefined || alliance === undefined) return acc;
    const attackableTargetUnits = targetUnits.filter(targetUnit => canAttack(fighter, targetUnit));
    // @ts-ignore
    const fighterDPS = getWeaponDPS(world, unitType, alliance, attackableTargetUnits.map(targetUnit => targetUnit.unitType));
    return acc + fighterDPS;
  }, 0);
  const targetUnitsHealth = getHealthAndShield(targetUnits);
  return targetUnitsHealth / fightersDPS;
}

/**
 * @description calculates the health and shield of the target units
 * @param {Unit[]} targetUnits
 * @returns {number}
 */
function getHealthAndShield(targetUnits) {
  const healthAndShield = targetUnits.reduce((acc, targetUnit) => {
    const { health, shield } = targetUnit; if (health === undefined || shield === undefined) return acc;
    return acc + health + shield;
  }, 0);
  return healthAndShield;
}

/**
 * @param {World} world
 * @param {UnitTypeId[]} unitTypesTraining
 * @param {Unit[]} threats
 * @returns {{timeToKill: number, timeToBeKilled: number}}
 */
function calculateTimeToKillForTrainingUnits(world, unitTypesTraining, threats) {
  const { getUnitTypeData } = unitResourceService;
  const { resources } = world;
  const { units } = resources.get();
  const timeToKill = threats.reduce((timeToKill, threat) => {
    const { health, shield, unitType } = threat; if (health === undefined || shield === undefined || unitType === undefined) return timeToKill;
    const totalHealth = health + shield;
    const totalWeaponDPS = unitTypesTraining.reduce((totalWeaponDPS, unitType) => {
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.SELF, threats.map(threat => threat.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToKillCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToKill === Infinity) ? timeToKillCurrent : timeToKill + timeToKillCurrent;
  }, Infinity);
  const timeToBeKilled = unitTypesTraining.reduce((timeToBeKilled, unitType) => {
    const { healthMax, shieldMax } = getUnitTypeData(units, unitType); if (healthMax === undefined || shieldMax === undefined) return timeToBeKilled;
    const totalHealth = healthMax + shieldMax;
    const totalWeaponDPS = threats.reduce((totalWeaponDPS, threat) => {
      const { unitType } = threat; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.ENEMY, unitTypesTraining);
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);
  return { timeToKill, timeToBeKilled };
}

/**
 * @param {World} world
 * @param {UnitTypeId[]} unitTypesTraining
 * @param {Unit[]} threats
 * @returns {Boolean}
 * @description returns true if training units can kill threats before they kill training units
 */
function canTrainingUnitsKillBeforeKilled(world, unitTypesTraining, threats) {
  console.log('unitTypesTraining', unitTypesTraining, 'threats', threats.map(threat => threat.unitType));
  const { timeToKill, timeToBeKilled } = calculateTimeToKillForTrainingUnits(world, unitTypesTraining, threats);
  console.log('timeToKill', timeToKill, 'timeToBeKilled', timeToBeKilled);
  return timeToKill < timeToBeKilled;
}

/**
 * Returns updated addOnType using countTypes.
 * @param {UnitTypeId} addOnType 
 * @param {Map} countTypes 
 * @returns {UnitTypeId}
 */
function updateAddOnType(addOnType, countTypes) {
  for (const [key, value] of countTypes.entries()) {
    if (value.includes(addOnType)) {
      return key;
    }
  }
  return addOnType;
}

/**
 * Returns unit type to build.
 * @param {Unit} unit 
 * @param {Map} flyingTypesMapping 
 * @param {UnitTypeId} addOnType 
 * @returns {UnitTypeId}
 */
function getUnitTypeToBuild(unit, flyingTypesMapping, addOnType) {
  return UnitType[`${UnitTypeId[flyingTypesMapping.get(unit.unitType) || unit.unitType]}${UnitTypeId[addOnType]}`];
}

/**
 * Attempt to build addOn
 * @param {World} world
 * @param {Unit} unit
 * @param {UnitTypeId} addOnType
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @returns {Promise<boolean>}
 */
async function attemptBuildAddOn(world, unit, addOnType, unitCommand) {
  const { data, resources } = world;
  const { actions, map } = resources.get();
  const { pos } = unit; if (pos === undefined) return false;
  const addonPlacement = getAddOnPlacement(pos);
  const addOnFootprint = getFootprint(addOnType);

  if (addOnFootprint === undefined) return false;

  const canPlace = map.isPlaceableAt(addOnType, addonPlacement) &&
    !pointsOverlap(cellsInFootprint(addonPlacement, addOnFootprint), unitResourceService.seigeTanksSiegedGrids);

  if (!canPlace) return false;

  unitCommand.targetWorldSpacePos = unit.pos;
  await actions.sendAction(unitCommand);
  planService.pausePlan = false;
  unitService.setPendingOrders(unit, unitCommand);
  addEarmark(data, data.getUnitTypeData(addOnType));

  return true;
}

/**
 * Attempt to lift off the unit if it doesn't have pending orders.
 * @param {ActionManager} actions 
 * @param {Unit} unit 
 * @returns {Promise<Boolean>}
 */
async function attemptLiftOff(actions, unit) {
  const { pos, tag } = unit; if (pos === undefined || tag === undefined) return false;
  if (!unit.labels.has('pendingOrders')) {
    const addOnPosition = unit.labels.get('addAddOn');
    if (addOnPosition && distance(getAddOnPlacement(pos), addOnPosition) < 1) {
      unit.labels.delete('addAddOn');
    } else {
      unit.labels.set('addAddOn', null);
      const unitCommand = {
        abilityId: Ability.LIFT,
        unitTags: [tag],
      };
      await actions.sendAction(unitCommand);
      unitService.setPendingOrders(unit, unitCommand);
      return true;
    }
  }
  return false;
}

/**
 * Attempts to land the unit at a suitable location.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {Promise<void>}
 */
async function attemptLand(world, unit, addOnType) {
  const { data, resources } = world;
  const { actions } = resources.get();
  const { tag, unitType } = unit; if (tag === undefined || unitType === undefined) return;
  const foundPosition = worldService.checkAddOnPlacement(world, unit, addOnType);

  if (!foundPosition) {
    return;
  }

  unit.labels.set('addAddOn', foundPosition);

  const unitCommand = {
    abilityId: data.getUnitTypeData(UnitType[`${UnitTypeId[flyingTypesMapping.get(unitType) || unitType]}${UnitTypeId[addOnType]}`]).abilityId,
    unitTags: [tag],
    targetWorldSpacePos: foundPosition
  }

  await actions.sendAction(unitCommand);
  planService.pausePlan = false;
  unitService.setPendingOrders(unit, unitCommand);
  addEarmark(data, data.getUnitTypeData(addOnType));
}

/**
 * Handle combat scenarios where the ally units are in a position to engage the enemy.
 * 
 * @param {World} world - The game world object.
 * @param {Unit[]} allyUnits - Array of ally units.
 * @param {Unit} closestEnemyUnit - The closest enemy unit.
 * @param {Unit[]} enemyUnits - Array of enemy units.
 * @param {Point2D} rallyPoint - The rally point for the units.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of combat actions to execute.
 */
function handleCombatScenarios(world, allyUnits, closestEnemyUnit, enemyUnits, rallyPoint) {
  const { units } = world.resources.get();
  const collectedActions = [];

  // Use the QUEEN units in case the closest enemy is flying and we don't have anti-air
  if (closestEnemyUnit.isFlying) {
    const findAntiAir = allyUnits.find(unit => unit.canShootUp());
    if (!findAntiAir) {
      allyUnits.push(...units.getById(UnitType.QUEEN));
    }
  }

  const combatPoint = armyManagementService.getCombatPoint(world.resources, allyUnits, closestEnemyUnit);
  if (combatPoint) {
    collectedActions.push(...armyManagementService.engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));
  }

  return collectedActions;
}
