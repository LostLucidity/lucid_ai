//@ts-check
"use strict"

const fs = require('fs');
const { UnitTypeId, Ability, UnitType, Buff, WarpUnitAbility, UpgradeId } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, STOP, CANCEL_QUEUE5, TRAIN_ZERGLING, RALLY_BUILDING, HARVEST_GATHER, SMART, LOAD_BUNKER, ATTACK } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance, WeaponTargetType, RaceId } = require("@node-sc2/core/constants/enums");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints, createPoint2D, add, subtract, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes, morphMapping, addOnTypesMapping, flyingTypesMapping, upgradeTypes } = require("../helper/groups");
const { getCandidatePositions, getInTheMain } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine, balanceResources } = require("../systems/manage-resources");
const { createUnitCommand } = require("../services/actions-service");
const dataService = require("../services/data-service");
const { formatToMinutesAndSeconds, getStringNameOfConstant } = require("../services/logging-service");
const loggingService = require("../services/logging-service");
const planService = require("../services/plan-service");
const { isPendingContructing } = require("../services/shared-service");
const { GasMineRace, WorkerRace, SupplyUnitRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { calculateHealthAdjustedSupply, getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { getPathablePositionsForStructure, getPathablePositions, isInMineralLine, isPlaceableAtGasGeyser } = require("../systems/map-resource-system/map-resource-service");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getOccupiedExpansions, getAvailableExpansions, getNextSafeExpansions } = require("../helper/expansions");
const { existsInMap } = require("../helper/location");
const { pointsOverlap, shuffle } = require("../helper/utilities");
const wallOffNaturalService = require("../systems/wall-off-natural/wall-off-natural-service");
const { findWallOffPlacement } = require("../systems/wall-off-ramp/wall-off-ramp-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const scoutingService = require("../systems/scouting/scouting-service");
const { getTimeInSeconds, getTravelDistancePerStep } = require("../services/frames-service");
const scoutService = require("../systems/scouting/scouting-service");
const path = require('path');
const foodUsedService = require('../services/food-used-service');
const { keepPosition, getBuildingFootprintOfOrphanAddons } = require('../services/placement-service');
const trackUnitsService = require('../systems/track-units/track-units-service');
const { canAttack } = require('../services/resources-service');
const { getMiddleOfStructure, moveAwayPosition, getDistance, getBorderPositions, dbscan, dbscanWithUnits, getStructureCells, getDistanceSquared } = require('../services/position-service');
const MapResourceService = require('../systems/map-resource-system/map-resource-service');
const { getPathCoordinates } = require('../services/path-service');
const resourceManagerService = require('../services/resource-manager-service');
const { getAddOnPlacement, getAddOnBuildingPosition, getAddOnBuildingPlacement } = require('../helper/placement/placement-utilities');
const { getEnemyUnits } = require('../systems/state-of-game-system/state-of-game-service');
const wallOffRampService = require('../systems/wall-off-ramp/wall-off-ramp-service');
const { isTrainingUnit, earmarkThresholdReached, getEarmarkedFood, hasEarmarks } = require('../services/data-service');
const unitTrainingService = require('../systems/unit-training/unit-training-service');
const microService = require('../services/micro-service');
const { getDistanceByPath } = require('../services/resource-manager-service');
const UnitAbilityMap = require('@node-sc2/core/constants/unit-ability-map');
const { ADEPTPHASESHIFT, QUEEN, BUNKER, WARPGATE, BARRACKSFLYING } = require('@node-sc2/core/constants/unit-type');
const { scanCloakedEnemy } = require('../helper/terran');
const { checkTechFor } = require('../services/agent-service');
const resourcesService = require('../services/resources-service');
const groupTypes = require('@node-sc2/core/constants/groups');
const unitService = require('../services/unit-service');
const { getDamageForTag, setDamageForTag } = require('../modules/damageManager');
const positionService = require('../services/position-service');

const worldService = {
  availableProductionUnits: new Map(),
  /** @type {number} */
  foodUsed: 12,
  /** @type {boolean} */
  outpowered: false,
  /** @type {Map<UnitTypeId, Unit[]>} */
  productionUnitsCache: new Map(),
  /** @type {number} */
  totalEnemyDPSHealth: 0,
  /** @type {number} */
  totalSelfDPSHealth: 0,
  /** @type {boolean} */
  unitProductionAvailable: true,
  /**
   * @param {World} world 
   * @param {AbilityId} abilityId 
   * @returns {Promise<any[]>}
  */
  ability: async (world, abilityId) => {
    const { getPendingOrders, setPendingOrders } = unitService;
    const { data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];

    const flyingTypesKeys = [...flyingTypesMapping.keys()];

    let canDoTypes = data.findUnitTypesWithAbility(abilityId)
      .map(unitTypeId => {
        const key = flyingTypesKeys.find(key => flyingTypesMapping.get(key) === unitTypeId);
        return key ? [unitTypeId, key] : [unitTypeId];
      }).flat();

    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF).reduce((/** @type {UnitTypeId[]} */acc, unit) => {
        if (unit.unitType) {
          acc.push(unit.unitType);
        }
        return acc;
      }, []);
    }

    const unitsCanDo = units.getById(canDoTypes);
    if (!unitsCanDo.length) return collectedActions;

    const unitsCanDoWithAbilityAvailable = unitsCanDo.filter(unit => 
      unit.abilityAvailable(abilityId) && getPendingOrders(unit).length === 0);

    let unitCanDo = getRandom(unitsCanDoWithAbilityAvailable);

    if (!unitCanDo) {
      const idleOrAlmostIdleUnits = unitsCanDo.filter(unit => 
        isIdleOrAlmostIdle(data, unit) && getPendingOrders(unit).length === 0);

      unitCanDo = getRandom(idleOrAlmostIdleUnits);
    }

    if (unitCanDo) {
      const unitCommand = createUnitCommand(abilityId, [unitCanDo]);
      setPendingOrders(unitCanDo, unitCommand);
      if (unitCanDo.abilityAvailable(abilityId)) {
        collectedActions.push(unitCommand);
      }
    }

    return collectedActions;
  },
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
        worldService.addEarmark(data, data.getUnitTypeData(addOnType));
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
 * @param {DataStorage} data 
 * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
 */
  addEarmark: (data, orderData) => {
    const { ZERGLING } = UnitType;
    const { getFoodUsed } = worldService;

    const { name, mineralCost, vespeneCost } = orderData;

    if (dataService.earmarkThresholdReached(data) || name === undefined || mineralCost === undefined || vespeneCost === undefined) return;

    const foodKey = `${getFoodUsed() + dataService.getEarmarkedFood()}`;
    const stepKey = `${planService.currentStep}`;
    const fullKey = `${stepKey}_${foodKey}`;

    let minerals = 0;
    let foodEarmark = dataService.foodEarmarks.get(fullKey) || 0;

    if ('unitId' in orderData) {
      const isZergling = orderData.unitId === ZERGLING;
      const { attributes, foodRequired, race, unitId } = orderData;

      if (attributes !== undefined && foodRequired !== undefined && race !== undefined && unitId !== undefined) {
        const adjustedFoodRequired = isZergling ? foodRequired * 2 : foodRequired;
        dataService.foodEarmarks.set(fullKey, foodEarmark + adjustedFoodRequired);

        // Check for town hall upgrades
        for (let [base, upgrades] of upgradeTypes.entries()) {
          if (upgrades.includes(unitId)) {
            const baseTownHallData = data.getUnitTypeData(base);
            minerals = -(baseTownHallData?.mineralCost ?? 400); // defaulting to 400 if not found
            break;
          }
        }

        if (race === Race.ZERG && attributes.includes(Attribute.STRUCTURE)) {
          dataService.foodEarmarks.set(fullKey, foodEarmark - 1);
        }
      }

      minerals += isZergling ? mineralCost * 2 : mineralCost;
    } else if ('upgradeId' in orderData) {
      // This is an upgrade
      minerals += mineralCost;
    }

    // set earmark name to include step number and food used plus food earmarked
    const earmarkName = `${name}_${fullKey}`;
    const earmark = {
      name: earmarkName,
      minerals,
      vespene: vespeneCost,
    }
    data.addEarmark(earmark);
    dataService.earmarks.push(earmark);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @param {Point2D} position
   * @param {Boolean} getMiddle
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  assignAndSendWorkerToBuild: (world, unitType, position, getMiddle = true) => {
    const { setPendingOrders } = unitService;
    const { agent, data, resources } = world;
    const { race } = agent;
    const { units } = resources.get();
    const { abilityId } = data.getUnitTypeData(unitType);
    const { getBuilder } = worldService;
    const collectedActions = [];
    position = getMiddle ? getMiddleOfStructure(position, unitType) : position;

    // Extracted as a function for reusability
    /** @param {Unit} unit */
    const getPositionDistance = (unit) => unit.pos ? getDistanceByPath(resources, unit.pos, position) : Infinity;

    const builder = getBuilder(world, position);
    if (builder) {
      let { unit } = builder;
      const { pos } = unit;
      if (!pos) return collectedActions;

      const currentUnitMovingToPosition = units.getWorkers().find(u => {
        const targetPosition = unitService.isMoving(u) && unitResourceService.getOrderTargetPosition(units, u);
        return targetPosition && areEqual(targetPosition, position);
      });

      if (currentUnitMovingToPosition && getPositionDistance(unit) > getPositionDistance(currentUnitMovingToPosition)) {
        unit = currentUnitMovingToPosition;
      }

      worldService.addEarmark(data, data.getUnitTypeData(unitType));
      if (!unit.isConstructing() && !isPendingContructing(unit) && abilityId !== undefined) {
        setBuilderLabel(unit);
        const unitCommand = createUnitCommand(abilityId, [unit]);

        if (GasMineRace[agent.race] === unitType) {
          const closestGasGeyser = units.getClosest(position, units.getGasGeysers())[0];
          if (closestGasGeyser) {
            unitCommand.targetUnitTag = closestGasGeyser.tag;
          }
        } else {
          unitCommand.targetWorldSpacePos = position;
        }

        collectedActions.push(unitCommand);
        console.log(`Command given: ${Object.keys(Ability).find(ability => Ability[ability] === abilityId)}`);

        if (TownhallRace[race].indexOf(unitType) === 0) {
          resourceManagerService.availableExpansions = [];
        }

        setPendingOrders(unit, unitCommand);
        collectedActions.push(...unitResourceService.stopOverlappingBuilders(units, unit, position));
      }
    }
    return collectedActions;
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
        if (!unit.isMelee() && closestUnit) { collectedActions.push(...worldService.microRangedUnit(world, unit, closestUnit)); }
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
   * 
   * @param {World} world 
   * @param {number} unitType 
   * @param {null | number} targetCount
   * @param {Point2D[]} candidatePositions
   * @returns {Promise<void>}
   */
  build: async (world, unitType, targetCount = null, candidatePositions = []) => {
    const { addonTypes } = groupTypes;
    const { BARRACKS, ORBITALCOMMAND, GREATERSPIRE } = UnitType;
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const { addEarmark, addAddOn, findAndPlaceBuilding, getUnitCount, getUnitTypeCount, morphStructureAction } = worldService;
    const unitTypeCount = getUnitTypeCount(world, unitType);
    const unitCount = getUnitCount(world, unitType);
    if (targetCount === null || (unitTypeCount <= targetCount && unitCount <= targetCount)) {
      const { race } = agent;
      switch (true) {
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
              candidatePositions = await getInTheMain(resources, unitType);
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
            } else {
              const availableExpansions = getAvailableExpansions(resources);
              const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
              if (nextSafeExpansions.length > 0) {
                candidatePositions.push(nextSafeExpansions[0]);
                collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
              }
            }
          } else {
            const unitTypeToCheckAfford = unitType === ORBITALCOMMAND ? BARRACKS : unitType;
            if (agent.canAfford(unitTypeToCheckAfford)) {
              collectedActions.push(...await morphStructureAction(world, unitType));
            }
            addEarmark(data, data.getUnitTypeData(unitType));
          }
          break;
        case addonTypes.includes(unitType): {
          const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
          const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
          const canDoTypeUnits = units.getById(canDoTypes);
          // First, get the units that can perform the action regardless of affordability
          if (agent.canAfford(unitType)) {
            const allUnits = getUnitsCapableToAddOn(canDoTypeUnits);

            let fastestAvailableUnit = null;
            let fastestAvailableTime = Infinity;

            // Calculate time until each unit can build the add-on
            for (let unit of allUnits) {
              let timeUntilAvailable = getTimeUntilUnitCanBuildAddon(world, unit);
              if (timeUntilAvailable < fastestAvailableTime) {
                fastestAvailableUnit = unit;
                fastestAvailableTime = timeUntilAvailable;
              }
            }

            // If a suitable unit is found, build the add-on with it
            if (fastestAvailableUnit) {
              addEarmark(data, data.getUnitTypeData(unitType));
              await addAddOn(world, fastestAvailableUnit, unitType);
            }
          } else {
            const timeUntilCanBeAfforded = getTimeUntilCanBeAfforded(world, unitType);
            const allUnits = getUnitsCapableToAddOn(canDoTypeUnits);

            let fastestAvailableUnit = null;
            let fastestAvailableTime = Infinity;

            // Calculate time until each unit can build the addon
            for (let unit of allUnits) {
              let timeUntilAvailable = getTimeUntilUnitCanBuildAddon(world, unit);
              if (timeUntilAvailable < fastestAvailableTime) {
                fastestAvailableUnit = unit;
                fastestAvailableTime = timeUntilAvailable;
              }
            }
            // Check if we have a suitable unit to build the addon soon
            if (fastestAvailableUnit && fastestAvailableTime >= timeUntilCanBeAfforded) {
              // Prepare the fastest available unit to build the addon
              // TODO: Implement a function to prepare the unit to build the addon
              let targetPosition = findBestPositionForAddOn(world, fastestAvailableUnit);
              const response = await prepareUnitToBuildAddon(world, fastestAvailableUnit, targetPosition); if (response === undefined) return;
            }
          }
          break;
        }
        default:
          if (unitType === GREATERSPIRE) {
            collectedActions.push(...await morphStructureAction(world, unitType));
          } else {
            collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
          }
      }
    }
    if (collectedActions.length > 0) {
      const response = await actions.sendAction(collectedActions);
      if (response.result === undefined) return;
    }
  },
  /**
   * @param {World} world
   * @param {number} unitType
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  buildGasMine: async (world, unitType) => {
    const { agent, resources } = world;
    const { actions, map } = resources.get();
    const { assignAndSendWorkerToBuild, premoveBuilderToPosition } = worldService;
    const collectedActions = [];

    const freeGasGeysers = MapResourceService.getFreeGasGeysers(map);
    if (freeGasGeysers.length === 0) return collectedActions;

    try {
      const { pos } = freeGasGeysers[0];
      if (pos === undefined) return collectedActions;

      if (agent.canAfford(unitType)) {
        await actions.sendAction(assignAndSendWorkerToBuild(world, unitType, pos));
        planService.pausePlan = false;
      } else {
        collectedActions.push(...premoveBuilderToPosition(world, pos, unitType));
      }
    } catch (error) {
      console.log(error);
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {number} limit
   * @param {boolean} checkCanBuild
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  buildWorkers: (world, limit = 1, checkCanBuild = false) => {
    const { agent, data, resources } = world;
    const { race } = agent;
    const { units } = resources.get();
    const { setPendingOrders } = unitService;
    const { canBuild, getIdleOrAlmostIdleUnits, isStrongerAtPosition } = worldService;
    const collectedActions = [];
    const workerTypeId = WorkerRace[agent.race];

    if (canBuild(world, workerTypeId) || checkCanBuild) {
      const { abilityId, foodRequired } = data.getUnitTypeData(workerTypeId);
      if (abilityId === undefined || foodRequired === undefined) return collectedActions;

      let trainers = [];
      if (agent.race === Race.ZERG) {
        trainers = units.getById(UnitType.LARVA).filter(larva => !larva['pendingOrders'] || larva['pendingOrders'].length === 0);
      } else {
        trainers = getIdleOrAlmostIdleUnits(world, WorkerRace[race]);
      }

      trainers = trainers.reduce((/** @type {Unit[]} */acc, trainer) => {
        if (trainer.pos) { // Ensure trainer has a position
          const point2D = { x: trainer.pos.x, y: trainer.pos.y }; // Convert to Point2D or use type assertion
          if (isStrongerAtPosition(world, point2D)) {
            acc.push(trainer);
          }
        }
        return acc;
      }, []);
      if (trainers.length > 0) {
        trainers = shuffle(trainers);
        trainers = trainers.slice(0, limit);
        trainers.forEach(trainer => {
          const unitCommand = createUnitCommand(abilityId, [trainer]);
          collectedActions.push(unitCommand);
          setPendingOrders(trainer, unitCommand);
          planService.pendingFood += foodRequired;
        });
        return collectedActions;
      }
    }

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
   * Calculate DPS health base on ally units and enemy armor upgrades.
   * @param {World} world 
   * @param {Unit[]} units
   * @param {UnitTypeId[]} enemyUnitTypes 
   * @returns {number}
   */
  calculateNearDPSHealth: (world, units, enemyUnitTypes) => {
    // If there are no enemy units, there's no DPS to calculate
    if (enemyUnitTypes.length === 0) {
      return 0;
    }

    const { resources } = world;
    const { map, units: unitResource } = resources.get();
    const { isByItselfAndNotAttacking } = unitResourceService;
    return units.reduce((accumulator, unit) => {
      const { pos } = unit; if (pos === undefined) return accumulator;
      if (unit.isWorker()) {
        if (unit.alliance === Alliance.SELF) {
          if (unit.isHarvesting() && !unit.labels.has('retreating') && !unit.labels.has('defending')) {
            return accumulator;
          }
        } else if (unit.alliance === Alliance.ENEMY) {
          if (isByItselfAndNotAttacking(unitResource, unit) || isInMineralLine(map, pos)) {
            return accumulator;
          }
        }
      }
      return accumulator + worldService.getDPSHealth(world, unit, enemyUnitTypes);
    }, 0);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitTypeId 
   * @returns {boolean}
   */
  canBuild: (world, unitTypeId) => {
    const { agent } = world;
    return agent.canAfford(unitTypeId) && agent.hasTechFor(unitTypeId) && (!worldService.isSupplyNeeded(world) || unitTypeId === UnitType.OVERLORD)
  },
  /**
 * @param {World} world 
 * @param {Unit} building 
 * @param {UnitTypeId} addOnType 
 * @returns {Point2D | undefined}
 */
  checkAddOnPlacement: (world, building, addOnType = UnitType.REACTOR) => {
    const { REACTOR, TECHLAB } = UnitType;
    const { findPosition } = worldService;
    const { resources } = world;
    const { map, units } = resources.get();
    const { unitType } = building; if (unitType === undefined) return;
    if (canUnitBuildAddOn(unitType)) {
      let position = null;
      let addOnPosition = null;
      let range = 1;
      do {
        const nearPoints = gridsInCircle(getAddOnPlacement(building.pos), range).filter(grid => {
          const addOnBuildingPlacementsForOrphanAddOns = units.getStructures(Alliance.SELF).reduce((/** @type {Point2D[]} */acc, structure) => {
            const { unitType } = structure; if (unitType === undefined) return acc;
            const isOrphanAddOn = [REACTOR, TECHLAB].includes(unitType); if (!isOrphanAddOn) return acc;
            return [...acc, ...cellsInFootprint(getAddOnBuildingPlacement(structure.pos), { h: 3, w: 3 })];
          }, []);
          const getBuildingAndAddOnPlacement = [...cellsInFootprint(grid, getFootprint(addOnType)), ...cellsInFootprint(getAddOnBuildingPlacement(grid), { h: 3, w: 3 })];
          return [
            existsInMap(map, grid) && map.isPlaceableAt(addOnType, grid) && map.isPlaceableAt(flyingTypesMapping.get(building.unitType) || building.unitType, getAddOnBuildingPlacement(grid)),
            !pointsOverlap(getBuildingAndAddOnPlacement, [...unitResourceService.seigeTanksSiegedGrids, ...addOnBuildingPlacementsForOrphanAddOns]),
          ].every(condition => condition);
        });
        if (nearPoints.length > 0) {
          if (Math.random() < (1 / 2)) {
            addOnPosition = nearPoints[Math.floor(Math.random() * nearPoints.length)];
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, addOnType)}`, addOnPosition);
            position = getAddOnBuildingPlacement(addOnPosition);
            console.log(`isPlaceableAt for ${getStringNameOfConstant(UnitType, building.unitType)}`, position);
          } else {
            addOnPosition = findPosition(world, addOnType, nearPoints);
            if (addOnPosition) {
              position = findPosition(world, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
            }
          }
        }
        range++
      } while (!position || !addOnPosition);
      return position;
    } else {
      return;
    }
  },
  /**
  * Returns boolean on whether build step should be executed.
  * @param {World} world 
  * @param {UnitTypeId} unitType 
  * @param {number} targetCount 
  * @returns {boolean}
  */
  checkBuildingCount: (world, unitType, targetCount) => {
    return worldService.getUnitTypeCount(world, unitType) === targetCount;
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
   * @param {UnitTypeId} unitType
   * @param {number} targetCount
   * @returns {boolean}
   */
  checkUnitCount: (world, unitType, targetCount) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const orders = [];
    let unitTypes = [];
    if (morphMapping.has(unitType)) {
      unitTypes = morphMapping.get(unitType);
    } else {
      unitTypes = [unitType];
    }
    let abilityId = data.getUnitTypeData(unitType).abilityId;
    units.withCurrentOrders(abilityId).forEach(unit => {
      unit.orders.forEach(order => { if (order.abilityId === abilityId) { orders.push(order); } });
    });
    const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => u.pendingOrders && u.pendingOrders.some(o => o.abilityId === abilityId));
    const unitCount = resourceManagerService.getById(resources, unitTypes).length + orders.length + unitsWithPendingOrders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    return unitCount === targetCount;
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
      const currentlyEnrouteConstructionGrids = worldService.getCurrentlyEnrouteConstructionGrids(world);
      const isCurrentlyEnroute = position && pointsOverlap(currentlyEnrouteConstructionGrids, [position]);
      return isPlaceableAt && !isCurrentlyEnroute;
    });
    unsettledBuildingPositions.forEach(([step]) => {
      buildingPositions.delete(step);
    });
  },
  /**
   * 
   * @param {World} world 
   * @param {UnitTypeId[]} mainCombatTypes 
   * @param {UnitTypeId[]} supportUnitTypes 
   * @param {Unit[]} threats 
   * @returns 
   */
  defend: async (world, mainCombatTypes, supportUnitTypes, threats) => {
    const { getClosestUnitByPath, getCombatRally } = resourceManagerService;
    const { getCombatPoint } = resourcesService;
    const { groupUnits } = unitService;
    const { engageOrRetreat, getDPSHealth, getWorkerDefenseCommands } = worldService;
    const { QUEEN } = UnitType;
    const { agent, data, resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const enemyUnits = enemyTrackingService.mappedEnemyUnits;
    const rallyPoint = getCombatRally(resources);
    if (rallyPoint) {
      let [closestEnemyUnit] = getClosestUnitByPath(resources, rallyPoint, threats);
      if (closestEnemyUnit) {
        const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
        const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
        const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !unitResourceService.isRepairing(unit));
        if (combatPoint) {
          let allyUnits = [...combatUnits, ...supportUnits];
          let selfDPSHealth = allyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, enemyUnits.map(enemyUnit => enemyUnit.unitType)), 0)
          if (selfDPSHealth > closestEnemyUnit['selfDPSHealth']) {
            console.log('Defend', selfDPSHealth, closestEnemyUnit['selfDPSHealth']);
            if (closestEnemyUnit.isFlying) {
              const findAntiAir = combatUnits.find(unit => unit.canShootUp());
              if (!findAntiAir) {
                combatUnits.push(...units.getById(QUEEN));
              }
            }
            const combatPoint = getCombatPoint(resources, combatUnits, closestEnemyUnit);
            if (combatPoint) {
              collectedActions.push(...engageOrRetreat(world, combatUnits, enemyUnits, rallyPoint));
            }
          } else {
            let workersToDefend = [];
            const inRangeSortedWorkers = units.getClosest(closestEnemyUnit.pos, workers, workers.length).filter(worker => distance(worker.pos, closestEnemyUnit.pos) <= 16);
            for (const worker of inRangeSortedWorkers) {
              workersToDefend.push(worker);
              selfDPSHealth += getDPSHealth(world, worker, enemyUnits.map(enemyUnit => enemyUnit.unitType));
              if (selfDPSHealth > closestEnemyUnit['selfDPSHealth']) {
                workersToDefend.forEach(worker => worker.labels.set('defending'));
                break;
              }
            }
            workersToDefend = selfDPSHealth > closestEnemyUnit['selfDPSHealth'] ? workersToDefend : [];
            allyUnits = [...allyUnits, ...units.getById(QUEEN), ...workersToDefend];
            collectedActions.push(...engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));
          }
        } else {
          // check if any non workers are training
          const unitsTraining = getUnitsTraining(world).filter(unitTraining => unitTraining.unitType !== WorkerRace[agent.race]);
          // if not, pull workers to defend
          if (unitsTraining.length === 0 || !canTrainingUnitsKillBeforeKilled(world, unitsTraining.map(unitTraining => unitTraining.unitType), threats)) {
            const workerDefenseCommands = getWorkerDefenseCommands(world, workers, closestEnemyUnit)
            console.log(`Pulling ${workerDefenseCommands.length} to defend with.`);
            collectedActions.push(...workerDefenseCommands);
          } else {
            // this condition is when workers are not needed to defend
            // grab any defending workers and send them back to work
            units.withLabel('defending').forEach(worker => {
              worker.labels.delete('defending');
              const { pos } = worker; if (pos === undefined) return;
              const closestEnemyThatCanAttackUnitByWeaponRange = getClosestThatCanAttackUnitByWeaponRange(data, worker, enemyUnits);
              const { enemyUnit } = closestEnemyThatCanAttackUnitByWeaponRange; if (enemyUnit === undefined) return;
              const { pos: targetPos } = enemyUnit; if (targetPos === undefined) return;
              const unitCommand = createUnitCommand(MOVE, [worker]);
              let closestCandidateMineralField = getClosestSafeMineralField(resources, pos, targetPos);
              if (closestCandidateMineralField !== undefined) {
                unitCommand.abilityId = HARVEST_GATHER;
                unitCommand.targetUnitTag = closestCandidateMineralField.tag;
              } else {
                const movePosition = moveAwayPosition(map, targetPos, pos);
                unitCommand.targetWorldSpacePos = movePosition !== null ? movePosition : undefined;
              }
              collectedActions.push(unitCommand);
            });
          }
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @param {number} unitType
   * @param {Point2D[]} candidatePositions
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  findAndPlaceBuilding: async (world, unitType, candidatePositions) => {
    const { PYLON } = UnitType;
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const { findPosition } = worldService;
    const collectedActions = []
    let position = planService.buildingPosition;
    const validPosition = position && keepPosition(world, unitType, position);
    if (!validPosition) {
      if (candidatePositions.length === 0) {
        candidatePositions = worldService.findPlacements(world, unitType);
      }
      position = findPosition(world, unitType, candidatePositions);
      if (!position) {
        candidatePositions = worldService.findPlacements(world, unitType);
        position = findPosition(world, unitType, candidatePositions);
      }
      planService.setBuildingPosition(unitType, position);
    }
    if (position) {
      // get unitTypes that can build the building
      const { abilityId } = data.getUnitTypeData(unitType);
      const unitTypes = data.findUnitTypesWithAbility(abilityId);
      if (!unitTypes.includes(UnitType.NYDUSNETWORK)) {
        if (agent.canAfford(unitType)) {
          const canPlaceOrFalse = await actions.canPlace(unitType, [position]);
          if (canPlaceOrFalse === false) {
            position = keepPosition(world, unitType, position) ? position : false;
            planService.setBuildingPosition(unitType, position);
            if (position) {
              collectedActions.push(...worldService.premoveBuilderToPosition(world, position, unitType));
            }
            worldService.addEarmark(data, data.getUnitTypeData(unitType));
          } else {
            await actions.sendAction(worldService.assignAndSendWorkerToBuild(world, unitType, canPlaceOrFalse));
            planService.pausePlan = false;
            planService.continueBuild = true;
          }
        } else {
          collectedActions.push(...worldService.premoveBuilderToPosition(world, position, unitType));
        }
      } else {
        collectedActions.push(...await buildWithNydusNetwork(world, unitType, abilityId));
      }
      const [pylon] = units.getById(PYLON);
      if (pylon && pylon.buildProgress < 1) {
        collectedActions.push(...worldService.premoveBuilderToPosition(world, pylon.pos, pylon.unitType));
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Point2D[]}
   */
  findPlacements: (world, unitType) => {
    const { getBuildTimeLeft } = unitService;
    const { BARRACKS, ENGINEERINGBAY, FORGE, PYLON, REACTOR, STARPORT, SUPPLYDEPOT, TECHLAB } = UnitType;
    const { gasMineTypes } = groupTypes;
    const { agent, data, resources } = world;
    const { race } = agent;
    const { map, units } = resources.get();
    const [main, natural] = map.getExpansions(); if (main === undefined || natural === undefined) { return []; }
    const mainMineralLine = main.areas.mineralLine;
    if (gasMineTypes.includes(unitType)) {
      const geyserPositions = MapResourceService.getFreeGasGeysers(map).map(geyser => {
        const { pos } = geyser;
        if (pos === undefined) return { pos, buildProgress: 0 };
        const [closestBase] = units.getClosest(pos, units.getBases());
        return { pos, buildProgress: closestBase.buildProgress };
      });
      const sortedGeyserPositions = geyserPositions
        .filter(geyser => {
          const { pos, buildProgress } = geyser; if (pos === undefined || buildProgress === undefined) return false;
          const [closestBase] = units.getClosest(pos, units.getBases()); if (closestBase === undefined) return false;
          const { unitType: baseType } = closestBase; if (baseType === undefined) return false;
          const { buildTime } = data.getUnitTypeData(baseType); if (buildTime === undefined) return false;
          const timeLeft = getBuildTimeLeft(closestBase, buildTime, buildProgress);
          const { buildTime: geyserBuildTime } = data.getUnitTypeData(unitType); if (geyserBuildTime === undefined) return false;
          return getTimeInSeconds(timeLeft) <= getTimeInSeconds(geyserBuildTime);
        }).sort((a, b) => {
          const { buildProgress: aBuildProgress, pos: aPos } = a;
          const { buildProgress: bBuildProgress, pos: bPos } = b;
          if (aBuildProgress === undefined || bBuildProgress === undefined || aPos === undefined || bPos === undefined) return 0;
          // @ts-ignore
          const [baseA] = units.getClosest(a, units.getBases());
          // @ts-ignore
          const [baseB] = units.getClosest(b, units.getBases());
          const { buildProgress: buildProgressA } = baseA;
          const { buildProgress: buildProgressB } = baseB;
          if (buildProgressA === undefined || buildProgressB === undefined) { return 0; }
          return buildProgressA - buildProgressB;
        });
      const [topGeyserPosition] = sortedGeyserPositions;
      if (topGeyserPosition) {
        const { buildProgress } = topGeyserPosition;
        if (buildProgress === undefined) { return []; }
        const sortedGeyserPositionsWithSameBuildProgress = sortedGeyserPositions.filter(geyserPosition => geyserPosition.buildProgress === buildProgress);
        // @ts-ignore
        return sortedGeyserPositionsWithSameBuildProgress.map(geyserPosition => geyserPosition.pos);
      } else {
        return [];
      }
    }
    /**
     * @type {Point2D[]}
     */
    let placements = [];
    if (race === Race.PROTOSS) {
      if (unitType === PYLON) {
        if (worldService.getUnitTypeCount(world, unitType) === 0) {
          if (planService.naturalWallPylon) {
            return getCandidatePositions(resources, 'NaturalWallPylon', unitType);
          }
        }
        const occupiedExpansions = getOccupiedExpansions(resources);
        const occupiedExpansionsPlacementGrid = [...occupiedExpansions.map(expansion => expansion.areas.placementGrid)];
        const placementGrids = [];
        occupiedExpansionsPlacementGrid.forEach(grid => placementGrids.push(...grid));
        placements = placementGrids
          .filter((point) => {
            return (
              (distance(natural.townhallPosition, point) > 4.5) &&
              (mainMineralLine.every(mlp => distance(mlp, point) > 1.5)) &&
              (natural.areas.hull.every(hp => distance(hp, point) > 3)) &&
              (units.getStructures({ alliance: Alliance.SELF })
                .map(u => u.pos)
                .every(eb => distance(eb, point) > 3))
            );
          });
      } else {
        let pylonsNearProduction;
        if (units.getById(PYLON).length === 1) {
          pylonsNearProduction = units.getById(PYLON);
        } else {
          pylonsNearProduction = units.getById(PYLON)
            .filter(u => u.buildProgress >= 1)
            .filter(pylon => distance(pylon.pos, main.townhallPosition) < 50);
        }
        pylonsNearProduction.forEach(pylon => {
          placements.push(...gridsInCircle(pylon.pos, 6.5, { normalize: true }).filter(grid => existsInMap(map, grid) && distance(grid, pylon.pos) < 6.5));
        });
        const wallOffPositions = [];
        let { threeByThreePositions } = wallOffNaturalService;
        const currentlyEnrouteConstructionGrids = worldService.getCurrentlyEnrouteConstructionGrids(world);
        // from the Map object planService.buildingPositions, get buildingPositions values
        /** @type {Point2D[]} */ // @ts-ignore
        const buildingPositions = Array.from(planService.buildingPositions.values()).filter(position => position !== false);
        const threeByThreeFootprint = getFootprint(FORGE); if (threeByThreeFootprint === undefined) return [];
        threeByThreePositions = threeByThreePositions.filter(position => !pointsOverlap([...currentlyEnrouteConstructionGrids, ...buildingPositions], cellsInFootprint(position, threeByThreeFootprint)));
        if (threeByThreePositions.length > 0) {
          const threeByThreeCellsInFootprints = threeByThreePositions.map(position => cellsInFootprint(position, threeByThreeFootprint));
          wallOffPositions.push(...threeByThreeCellsInFootprints.flat().filter(position => !pointsOverlap(currentlyEnrouteConstructionGrids, cellsInFootprint(position, threeByThreeFootprint))));
          const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
          if (unitTypeFootprint.h === threeByThreeFootprint.h && unitTypeFootprint.w === threeByThreeFootprint.w) {
            const canPlace = getRandom(threeByThreePositions.filter(pos => map.isPlaceableAt(unitType, pos)));
            if (canPlace) {
              return [canPlace];
            }
          }
        }
        const unitTypeFootprint = getFootprint(unitType); if (unitTypeFootprint === undefined) return [];
        placements = placements.filter(grid => {
          const cells = [...cellsInFootprint(grid, unitTypeFootprint)];
          return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions]);
        }).map(pos => ({ pos, rand: Math.random() }))
          .sort((a, b) => a.rand - b.rand)
          .map(a => a.pos)
          .slice(0, 20);
        return placements;

      }
    } else if (race === Race.TERRAN) {
      const placementGrids = [];
      const orphanAddons = units.getById([REACTOR, TECHLAB]);

      const buildingFootprints = Array.from(planService.buildingPositions.entries()).reduce((/** @type {Point2D[]} */positions, [step, buildingPos]) => {
        if (buildingPos === false) return positions;
        const stepData = planService.plan[step] ?
          planService.plan[step] :
          planService.convertLegacyPlan(planService.legacyPlan)[step];

        const stepUnitType = (stepData && stepData[2]) ? stepData[2] : undefined;

        if (unitType === undefined) return positions;

        const footprint = getFootprint(stepUnitType); if (footprint === undefined) return positions;
        const newPositions = cellsInFootprint(buildingPos, footprint);
        if (canUnitBuildAddOn(stepUnitType)) {
          const addonFootprint = getFootprint(REACTOR); if (addonFootprint === undefined) return positions;
          const addonPositions = cellsInFootprint(getAddOnPlacement(buildingPos), addonFootprint);
          return [...positions, ...newPositions, ...addonPositions];
        }
        return [...positions, ...newPositions];
      }, []);

      const orphanAddonPositions = orphanAddons.reduce((/** @type {Point2D[]} */positions, addon) => {
        const { pos } = addon; if (pos === undefined) return positions;
        const newPositions = getAddOnBuildingPlacement(pos);
        const footprint = getFootprint(addon.unitType); if (footprint === undefined) return positions;
        const cells = cellsInFootprint(newPositions, footprint);
        if (cells.length === 0) return positions;
        return [...positions, ...cells];
      }, []);

      const wallOffPositions = findWallOffPlacement(unitType).slice();
      if (wallOffPositions.filter(position => map.isPlaceableAt(unitType, position)).length > 0) {
        // Check if the structure is one that cannot use an orphan add-on
        if (!canUnitBuildAddOn(unitType)) {
          // Exclude positions that are suitable for orphan add-ons and inside existing footprints
          const filteredWallOffPositions = wallOffPositions.filter(position =>
            !orphanAddonPositions.some(orphanPosition => getDistance(orphanPosition, position) < 1) &&
            !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
          );
          // If there are any positions left, use them
          if (filteredWallOffPositions.length > 0) {
            return filteredWallOffPositions;
          }
        }
        // If the structure can use an orphan add-on, use all wall-off positions
        if (wallOffPositions.length > 0) {
          // Filter out positions already taken by buildings
          const newWallOffPositions = wallOffPositions.filter(position =>
            !buildingFootprints.some(buildingFootprint => getDistance(buildingFootprint, position) < 1)
          );
          if (newWallOffPositions.length > 0) {
            return newWallOffPositions;
          }
        }
      }

      getOccupiedExpansions(world.resources).forEach(expansion => {
        placementGrids.push(...expansion.areas.placementGrid);
      });
      const { addOnPositions, twoByTwoPositions, threeByThreePositions } = wallOffRampService;
      if (addOnPositions.length > 0) {
        const barracksFootprint = getFootprint(BARRACKS);
        if (barracksFootprint === undefined) return [];
        const barracksCellInFootprints = addOnPositions.map(position => cellsInFootprint(createPoint2D(position), barracksFootprint));
        wallOffPositions.push(...barracksCellInFootprints.flat());
      }
      if (twoByTwoPositions.length > 0) {
        const supplyFootprint = getFootprint(SUPPLYDEPOT);
        if (supplyFootprint === undefined) return [];
        const supplyCellInFootprints = twoByTwoPositions.map(position => cellsInFootprint(position, supplyFootprint));
        wallOffPositions.push(...supplyCellInFootprints.flat());
      }
      if (threeByThreePositions.length > 0) {
        const engineeringBayFootprint = getFootprint(ENGINEERINGBAY);
        if (engineeringBayFootprint === undefined) return [];
        const engineeringBayCellInFootprints = threeByThreePositions.map(position => cellsInFootprint(position, engineeringBayFootprint));
        wallOffPositions.push(...engineeringBayCellInFootprints.flat());
      }
      const unitTypeFootprint = getFootprint(unitType);
      let addonFootprint;
      if (addOnTypesMapping.has(unitType)) {
        addonFootprint = getFootprint(REACTOR); if (addonFootprint === undefined) return [];
      }
      if (unitTypeFootprint === undefined) return [];
      // Get all existing barracks and starports
      const barracks = units.getById(BARRACKS);
      const starports = units.getById(STARPORT);
      const barracksPositions = barracks.map(b => b.pos);
      const buildingFootprintOfOrphanAddons = getBuildingFootprintOfOrphanAddons(units);

      placements = placementGrids.filter(grid => {
        const cells = [...cellsInFootprint(grid, unitTypeFootprint)];

        // Check if the unit is a STARPORT and there's a nearby BARRACKS, and it's the first STARPORT
        if (unitType === STARPORT && starports.length === 0) {
          // If there is no nearby BARRACKS within 23.6 units, return false to filter out this grid
          if (!barracksPositions.some(bPos => bPos && getDistance(bPos, grid) <= 23.6)) {
            return false;
          }
        }

        if (addonFootprint) {
          cells.push(...cellsInFootprint(getAddOnPlacement(grid), addonFootprint));
        }

        return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions, ...buildingFootprintOfOrphanAddons, ...orphanAddonPositions]);
      }).map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements.push(...findZergPlacements(world, unitType))
    }
    return placements;
  },
  /**
   * @param {World} world
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} radius
   * @returns {Point2D|undefined}
   */
  findClosestSafePosition: (world, unit, targetUnit, radius = 1) => {
    const { resources } = world;
    const { units } = resources.get();
    const { getClosestPositionByPath } = resourceManagerService;
    const safePositions = getSafePositions(world, unit, targetUnit, radius);
    const { pos } = unit; if (pos === undefined) return;

    // Derive safetyRadius based on unit and potential threats
    const safetyRadius = deriveSafetyRadius(world, unit, units.getAlive(Alliance.ENEMY));

    // Filter the safe positions to avoid positions too close to enemy units
    const trulySafePositions = safePositions.filter(position => isTrulySafe(world, position, safetyRadius));

    // Return early if no safe positions are found
    if (trulySafePositions.length === 0) return;

    // If the unit is flying, simply get the closest position
    if (unit.isFlying) {
      const [closestPoint] = getClosestPosition(pos, trulySafePositions);
      return closestPoint;
    }

    // If the unit has a current destination, find the closest position by path
    const currentDestination = unitResourceService.getOrderTargetPosition(units, unit);
    if (currentDestination !== undefined) {
      const [closestPoint] = getClosestPositionByPath(resources, currentDestination, trulySafePositions);
      return closestPoint;
    }

    // Fallback mechanism: Return closest position based on simple distance if no other criteria are met
    const [fallbackPosition] = getClosestPosition(pos, trulySafePositions);
    return fallbackPosition;
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @returns {false | Point2D}
   */
  findPosition: (world, unitType, candidatePositions) => {
    const { gasMineTypes } = groupTypes;
    if (candidatePositions.length === 0) {
      candidatePositions = worldService.findPlacements(world, unitType);
    }
    const {agent, resources } = world;
    const { map } = resources.get();
    if (flyingTypesMapping.has(unitType)) {
      const baseUnitType = flyingTypesMapping.get(unitType);
      unitType = baseUnitType === undefined ? unitType : baseUnitType;
    }
    candidatePositions = candidatePositions.filter(position => {
      const footprint = getFootprint(unitType); if (footprint === undefined) return false;
      const unitTypeCells = cellsInFootprint(position, footprint);
      if (gasMineTypes.includes(unitType)) return isPlaceableAtGasGeyser(map, unitType, position);
      const isPlaceable = unitTypeCells.every(cell => {
        const isPlaceable = map.isPlaceable(cell);
        const needsCreep = agent.race === Race.ZERG && unitType !== UnitType.HATCHERY;
        const hasCreep = map.hasCreep(cell);
        return isPlaceable && (!needsCreep || hasCreep);
      });
      return isPlaceable;
    });
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    let foundPosition = getRandom(randomPositions);
    const unitTypeName = Object.keys(UnitType).find(type => UnitType[type] === unitType);
    if (foundPosition) console.log(`Found position for ${unitTypeName}`, foundPosition);
    else console.log(`Could not find position for ${unitTypeName}`);
    return foundPosition;
  },
  /**
   * @param {DataStorage} data
   * @param {UnitTypeId} unitType
   * @returns {AbilityId[]}
   */
  getAbilityIdsForAddons: (data, unitType) => {
    let { abilityId } = data.getUnitTypeData(unitType);
    let abilityIds = [];
    if (abilityId === 1674) {
      abilityIds.push(...worldService.getReactorAbilities(data));
    } else if (abilityId === 1666) {
      abilityIds.push(...worldService.getTechlabAbilities(data));
    } else {
      abilityIds.push(abilityId);
    }
    return abilityIds;
  },
  /**
   * @param {World} world 
   * @param {Point2D} position 
   * @returns {{unit: Unit, timeToPosition: number} | undefined}
   */
  getBuilder: (world, position) => {
    const { getBuilders } = unitResourceService;
    const { resources } = world;
    const { units } = resources.get();

    // Define builderCandidates before using it
    let builderCandidates = getBuilders(units);

    builderCandidates = gatherBuilderCandidates(units, builderCandidates, position);
    const movingOrConstructingNonDrones = filterMovingOrConstructingNonDrones(units, builderCandidates);
    builderCandidates = filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones);

    const builderCandidateClusters = getBuilderCandidateClusters(builderCandidates);

    let closestBuilderCandidate = getClosestBuilderCandidate(resources, builderCandidateClusters, position);
    const movingOrConstructingNonDronesTimeToPosition = calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position);

    const candidateWorkersTimeToPosition = gatherCandidateWorkersTimeToPosition(resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilderCandidate);

    const constructingWorkers = units.getConstructingWorkers();
    const closestConstructingWorker = calculateClosestConstructingWorker(world, constructingWorkers, position);

    if (closestConstructingWorker !== undefined) {
      candidateWorkersTimeToPosition.push(closestConstructingWorker);
    }

    const [closestWorker] = candidateWorkersTimeToPosition.sort((a, b) => {
      if (a === undefined || b === undefined) return 0;
      return a.timeToPosition - b.timeToPosition;
    });

    if (closestWorker === undefined) return;
    return closestWorker;
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
    const { getClosestPositionByPath } = resourceManagerService;
    const positionsInRangeOfEnemyUnits = findPositionsInRangeOfEnemyUnits(world, unit, closeAttackableEnemyUnits);
    const positionsInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks = positionsInRangeOfEnemyUnits.filter(position => !enemyUnitsInRangeOfTheirAttack.some(enemyUnit => isInRangeOfEnemyUnits(data, unit, enemyUnit, position)));
    const [closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks] = getClosestPositionByPath(resources, pos, positionsInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks);
    if (closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks !== undefined) {
      const [closestPositionInRangeOfEnemyUnits] = getClosestPositionByPath(resources, pos, positionsInRangeOfEnemyUnits);
      const samePosition = closestPositionInRangeOfEnemyUnits !== undefined && closestPositionInRangeOfEnemyUnits.x === closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks.x && closestPositionInRangeOfEnemyUnits.y === closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks.y;
      let abilityId = samePosition ? ATTACK_ATTACK : MOVE;
      const unitCommand = createUnitCommand(abilityId, [unit]);
      unitCommand.targetWorldSpacePos = samePosition ? closeAttackableEnemyUnits[0].pos : closestPositionInRangeOfEnemyUnitsNotInRangeOfEnemyAttacks;
      return unitCommand;
    }
  },
  /**
   * @param {World} world
   * @returns {Point2D[]}
   */
  getCurrentlyEnrouteConstructionGrids: (world) => {
    const { constructionAbilities } = groupTypes;
    const { data, resources } = world;
    const { units } = resources.get();
    const contructionGrids = [];
    units.getWorkers().forEach(worker => {
      const { orders } = worker; if (orders === undefined) return;
      const allOrders = [...orders, ...(unitService.getPendingOrders(worker))];
      const moveOrder = allOrders.find(order => order.abilityId === MOVE);
      if (moveOrder && moveOrder.targetWorldSpacePos) {
        const intendedConstructionLocation = moveOrder.targetWorldSpacePos;
        // Find corresponding building type
        const buildingStep = [...planService.buildingPositions.entries()].find((entry) => getDistance(entry[1], intendedConstructionLocation) < 1)
        if (buildingStep) {
          const buildingType = planService.legacyPlan[buildingStep[0]][2];
          const footprint = getFootprint(buildingType);
          if (footprint) {
            contructionGrids.push(...cellsInFootprint(createPoint2D(intendedConstructionLocation), footprint));
          }
        }
      }
      if (worker.isConstructing() || isPendingContructing(worker)) {
        const foundOrder = allOrders.find(order => constructionAbilities.includes(order.abilityId));
        if (foundOrder && foundOrder.targetWorldSpacePos) {
          const foundUnitTypeName = Object.keys(UnitType).find(unitType => data.getUnitTypeData(UnitType[unitType]).abilityId === foundOrder.abilityId);
          if (foundUnitTypeName) {
            contructionGrids.push(...cellsInFootprint(createPoint2D(foundOrder.targetWorldSpacePos), getFootprint(UnitType[foundUnitTypeName])));
          }
        }
      }
    });
    return contructionGrids;
  },
  
  /**
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit[]} enemyUnits
   * @returns {Unit[]}
   */
  getDamageDealingUnits: (world, unit, enemyUnits) => {
    return enemyUnits.filter(enemyUnit => {
      if (canAttack(enemyUnit, unit) && inCombatRange(world, enemyUnit, unit)) {
        return true;
      } else {
        return false;
      }
    });
  },
  /**
   * @param {World} world 
   * @param {Unit} unit
   * @param {UnitTypeId[]} enemyUnitTypes 
   * @returns {number}
   */
  getDPSHealth: (world, unit, enemyUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    const { getUnitTypeData } = unitResourceService;
    const { ADEPT, ADEPTPHASESHIFT } = UnitType;
    let dPSHealth = 0;
    // if unit.unitType is an ADEPTPHASESHIFT, use values of ADEPT assigned to it
    let { alliance, buffIds, health, buildProgress, shield, unitType } = unit;
    if (alliance === undefined || buffIds === undefined || health === undefined || buildProgress === undefined || shield === undefined || unitType === undefined) return 0;
    unitType = unitType !== ADEPTPHASESHIFT ? unitType : ADEPT;
    unit = getUnitForDPSCalculation(resources, unit);
    let healthAndShield = 0;
    if (unit && buildProgress >= 1) {
      healthAndShield = health + shield;
    } else {
      const unitTypeData = getUnitTypeData(units, unitType);
      if (unitTypeData) {
        const { healthMax, shieldMax } = unitTypeData;
        healthAndShield = healthMax + shieldMax;
      }
    }
    if (buildProgress > 0.90) {
      dPSHealth = worldService.getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * healthAndShield * (buffIds.includes(Buff.STIMPACK) ? 1.5 : 1);
    }
    return dPSHealth;
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
      dPSHealth = worldService.getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * (healthMax + shieldMax);
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
    const { addEarmark, getFoodUsed, getIdleOrAlmostIdleUnits } = worldService;
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
    const { data, resources } = world;
    const { units } = resources.get();
    const enemyUnits = units.getAlive(Alliance.ENEMY);
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
      if (distance(pos, enemyPos) <= range + radius + enemyRadius) {
        dPS = worldService.getWeaponDPS(world, enemyUnitType, alliance, [unitType]);
      }
      return accumulator + dPS;
    }, 0);
  },
  /**
   * @returns {number}
   */
  getFoodUsed: () => {
    return worldService.foodUsed;
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {Unit[]}
   */
  getIdleOrAlmostIdleUnits: (world, unitType) => {
    const { getBuildTimeLeft, getPendingOrders } = unitService;
    const { data } = world;

    return worldService.getProductionUnits(world, unitType).filter(unit => {
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
   * @param {World} world
   * @param {UnitTypeId} unitTypeId
   * @returns {Unit[]}
   */
  getProductionUnits: (world, unitTypeId) => {
    const { units } = world.resources.get();
    const { productionUnitsCache } = worldService;
    // Check if the result is in the cache
    if (productionUnitsCache.has(unitTypeId)) {
      return productionUnitsCache.get(unitTypeId) || [];
    }

    const { abilityId } = world.data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];
    let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);

    if (producerUnitTypeIds.length <= 0) {
      const alias = world.data.getAbilityData(abilityId).remapsToAbilityId; if (alias === undefined) return [];
      producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
    }

    const result = units.getByType(producerUnitTypeIds);

    // Store the result in the cache
    productionUnitsCache.set(unitTypeId, result);

    return result;
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
   * @returns {Unit[]}
   */
  getUnitsCanDoWithoutAddOnAndIdle: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
    const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
    const canDoTypeUnits = units.getById(canDoTypes);
    const addOnUnits = units.withLabel('addAddOn');
    const availableAddOnUnits = addOnUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId)));
    const availableCanDoTypeUnits = canDoTypeUnits.filter(unit => abilityIds.some(abilityId => unit.abilityAvailable(abilityId) && !unit.labels.has('reposition')));
    return availableAddOnUnits.length > 0 ? availableAddOnUnits : availableCanDoTypeUnits;
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
        step.targetCount === worldService.getUnitTypeCount(world, unitType) + (unitType === DRONE ? units.getStructures().length - 1 : 0)
      );
    });
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
    const productionUnits = worldService.getProductionUnits(world, unitType);
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
   * Checks if the player's units are stronger at a specific position compared to enemy units.
   *
   * @param {World} world - The current game world state.
   * @param {Point2D} position - The position to check.
   * @returns {boolean} - Returns true if the player's units are stronger at the given position, otherwise false.
   */
  isStrongerAtPosition: (world, position) => {
    const { units } = world.resources.get();

    /**
     * Retrieves units within a specified radius from a position.
     * @param {Unit[]} unitArray - Array of units.
     * @param {number} rad - Radius to filter units by.
     * @returns {Unit[]} - Units within the specified radius.
     */
    const getUnitsInRadius = (unitArray, rad) =>
      unitArray.filter(unit => unit.pos && distance(unit.pos, position) < rad);

    let enemyUnits = getUnitsInRadius(enemyTrackingService.mappedEnemyUnits, 16).filter(unitService.potentialCombatants);

    // If there's only one enemy and it's a non-combatant worker, disregard it
    if (enemyUnits.length === 1 && !unitService.potentialCombatants(enemyUnits[0])) {
      enemyUnits = [];
    }

    // If no potential enemy combatants, player is stronger by default
    if (!enemyUnits.length) return true;

    const selfUnits = getUnitsInRadius(units.getAlive(Alliance.SELF), 16).filter(unitService.potentialCombatants);

    return worldService.shouldEngage(world, selfUnits, enemyUnits);
  },
  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getReactorAbilities: (data) => {
    const { reactorTypes } = require("@node-sc2/core/constants/groups");
    const reactorAbilities = [];
    reactorTypes.forEach(type => {
      reactorAbilities.push(data.getUnitTypeData(type).abilityId)
    });
    return reactorAbilities;
  },
  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getTechlabAbilities: (data) => {
    const { techLabTypes } = groupTypes;
    const techlabAbilities = [];
    techLabTypes.forEach(type => {
      techlabAbilities.push(data.getUnitTypeData(type).abilityId)
    });
    return techlabAbilities;
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitTypeId
   * @returns {Unit[]}
   */
  getTrainer: (world, unitTypeId) => {
    const { getPendingOrders } = unitService;
    const { WARPGATE } = UnitType;
    const { data, resources } = world;
    const { units } = resources.get();
    let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];

    const unitFilter = (/** @type {Unit} */ unit) => {
      const { orders } = unit;
      const pendingOrders = getPendingOrders(unit);
      if (abilityId === undefined || orders === undefined || pendingOrders === undefined) return false;
      const allOrders = [...orders, ...pendingOrders];
      const spaceToTrain = allOrders.length === 0 || (unit.hasReactor() && allOrders.length < 2);
      return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition');
    };

    let productionUnits = worldService.getProductionUnits(world, unitTypeId).filter(unitFilter);

    if (productionUnits.length === 0) {
      const abilityId = WarpUnitAbility[unitTypeId];
      productionUnits = units.getById(WARPGATE).filter(warpgate => abilityId && warpgate.abilityAvailable(abilityId));
    }

    // Check for flying units
    const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
    const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
    const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle());

    productionUnits = [...productionUnits, ...flyingUnits];

    return productionUnits;
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
    return worldService.getUnitsWithCurrentOrders(units, [abilityId]);
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Alliance} alliance
   * @param {UnitTypeId[]} enemyUnitTypes
   * @returns {number}
  */
  getWeaponDPS(world, unitType, alliance, enemyUnitTypes) {
    const { getArmorUpgradeLevel, getAttackUpgradeLevel } = unitService;
    const { calculateSplashDamage } = unitResourceService;
    const { data, resources } = world;
    const { units } = resources.get();
    const { weapons } = data.getUnitTypeData(unitType);
    if (weapons === undefined) return 0;
    const weaponsDPS = weapons.map(weapon => {
      const weaponAverageDPSAgainstTypes = enemyUnitTypes.reduce((totalDPS, enemyUnitType) => {
        const { attacks, damage, speed } = weapon;
        if (!attacks || !damage || !speed) return totalDPS;
        if (canWeaponAttackType(units, weapon, enemyUnitType)) {
          const weaponUpgradeDamage = damage + (getAttackUpgradeLevel(alliance) * dataService.getUpgradeBonus(alliance, weapon.damage));
          const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, [enemyUnitType]);
          const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(alliance) + weaponBonusDamage;
          const weaponSplashDamage = calculateSplashDamage(units, unitType, enemyUnitTypes);
          return totalDPS + (weaponDamage * attacks * weaponSplashDamage) / (speed / 1.4);
        }
        return totalDPS;
      }, 0);
      return weaponAverageDPSAgainstTypes / enemyUnitTypes.length;
    });
    // return max of weaponsDPS, if no value found in weaponsDPS, return 0
    if (weaponsDPS.length === 0) return 0;
    return Math.max.apply(Math, weaponsDPS);
  },
  /**
   * Get the raw damage value for a single attack from one type of unit against another.
   *
   * @param {World} world - The game state or environment.
   * @param {number} attackingUnitType - The unit type ID of the attacking unit.
   * @param {number} targetUnitType - The unit type ID of the target unit.
   * @param {Alliance} targetAlliance - The alliance of the target unit.
   * @returns {number} - The damage per hit, accounting for multiple attacks, damage bonuses, and armor if applicable. Returns 0 if no valid weapon can attack the target unit types.
   */
  getWeaponDamage: (world, attackingUnitType, targetUnitType, targetAlliance) => {
    const { data } = world;

    /** @type {SC2APIProtocol.Weapon | undefined} */
    const weaponThatCanAttack = unitService.getWeaponThatCanAttack(data, attackingUnitType, targetUnitType);

    if (weaponThatCanAttack) {
      let rawDamage = weaponThatCanAttack.damage || 0;
      const numberOfAttacks = weaponThatCanAttack.attacks || 1;

      // Account for any damage bonuses
      if (weaponThatCanAttack.damageBonus) {
        const targetAttributes = data.getUnitTypeData(targetUnitType).attributes || [];
        for (const damageBonus of weaponThatCanAttack.damageBonus) {
          if (damageBonus.attribute && targetAttributes.includes(damageBonus.attribute)) {
            rawDamage += (damageBonus.bonus || 0);
            break;
          }
        }
      }

      // Account for enemy armor
      const armorUpgradeLevel = unitService.getArmorUpgradeLevel(targetAlliance);
      const armor = data.getUnitTypeData(targetUnitType).armor || 0;
      const effectiveArmor = armor + armorUpgradeLevel;
      rawDamage = Math.max(0, rawDamage - effectiveArmor);

      // Calculate total damage accounting for the number of attacks
      return rawDamage * numberOfAttacks;
    }

    return 0; // Return 0 if no valid weapon can attack the target unit types
  },
  /**
   * @param {UnitResource} units
   * @param {AbilityId[]} abilityIds
   * @returns {Unit[]}
   */
  getUnitsWithCurrentOrders: (units, abilityIds) => {
    const unitsWithCurrentOrders = [];
    const allUnits = units.getAlive(Alliance.SELF);

    abilityIds.forEach(abilityId => {
      // Add units with matching current orders
      unitsWithCurrentOrders.push(...units.withCurrentOrders(abilityId));

      // Add units with matching pending orders
      allUnits.forEach(unit => {
        const pendingOrders = unitService.getPendingOrders(unit);
        if (pendingOrders.some(order => order.abilityId === abilityId)) {
          unitsWithCurrentOrders.push(unit);
        }
      });
    });

    // Remove duplicates
    return Array.from(new Set(unitsWithCurrentOrders));
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
      return worldService.getUnitTypeCount(world, unitType);
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
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {number}
   */
  getUnitTypeCount: (world, unitType) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
    const unitsWithCurrentOrders = worldService.getUnitsWithCurrentOrders(units, abilityIds);
    let count = unitsWithCurrentOrders.length;
    const unitTypes = countTypes.get(unitType) ? countTypes.get(unitType) : [unitType];
    unitTypes.forEach(type => {
      let unitsToCount = resourceManagerService.getById(resources, [type])
      if (agent.race === Race.TERRAN) {
        const completed = type === UnitType.ORBITALCOMMAND ? 0.998 : 1;
        unitsToCount = unitsToCount.filter(unit => unit.buildProgress >= completed);
      }
      count += unitsToCount.length;
    });
    return count;
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
    const zerglings = enemyTrackingService.mappedEnemyUnits.filter(unit => unit.unitType === ZERGLING);
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
   * @param {number} buffer 
   * @returns {boolean} 
   */
  isSupplyNeeded: (world, buffer = 0) => {
    const { agent, data, resources } = world;
    const { foodCap, foodUsed } = agent;
    const { units } = resources.get()
    const supplyUnitId = SupplyUnitRace[agent.race];
    const buildAbilityId = data.getUnitTypeData(supplyUnitId).abilityId;
    const pendingSupply = (
      (units.inProgress(supplyUnitId).length * 8) +
      (units.withCurrentOrders(buildAbilityId).length * 8)
    );
    const pendingSupplyCap = foodCap + pendingSupply;
    const supplyLeft = foodCap - foodUsed;
    const pendingSupplyLeft = supplyLeft + pendingSupply;
    const conditions = [
      pendingSupplyLeft < pendingSupplyCap * buffer,
      !(foodCap == 200),
    ];
    return conditions.every(c => c);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  morphStructureAction: async (world, unitType) => {
    const { CYCLONE, LAIR } = UnitType;
    const {agent, data } = world;
    const collectedActions = [];
    const { addEarmark, ability, unpauseAndLog } = worldService;
    // use unitType for LAIR with CYCLONE when can afford as LAIR data is inflated by the cost of a HATCHERY
    if (agent.canAfford(unitType === LAIR ? CYCLONE : unitType)) {
      const { abilityId } = data.getUnitTypeData(unitType); if (abilityId === undefined) return collectedActions;
      const actions = await ability(world, abilityId);
      if (actions.length > 0) {
        unpauseAndLog(world, UnitTypeId[unitType]);
        collectedActions.push(...actions);
      }
    }
    addEarmark(data, data.getUnitTypeData(unitType));
    return collectedActions;
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
    const { mappedEnemyUnits } = enemyTrackingService;
    const { getClosestUnitByPath } = resourceManagerService;
    const { pos } = targetUnit; if (pos === undefined) return false;
    const { isRepairing } = unitResourceService;
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy', 'builder']) && !isRepairing(unit));
    const potentialFightersByDistance = getClosestUnitByPath(resources, pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), workers.length);
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
    const targetUnits = getInRangeUnits(targetUnit, mappedEnemyUnits, 16);
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
   * Generates unit commands to direct given units to either engage in battle or retreat.
   *
   * @param {World} world - The game world.
   * @param {Unit[]} selfUnits - Array of player's units.
   * @param {Unit[]} enemyUnits - Array of enemy units.
   * @param {Point2D} position - Point to either move towards or retreat from.
   * @param {boolean} [clearRocks=true] - Indicates if destructible rocks should be targeted.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} Array of commands.
   */
  engageOrRetreat: (world, selfUnits, enemyUnits, position, clearRocks = true) => {
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    // First, separate out injector QUEENs from other units
    // Extract QUEEN related logic
    const injectorQueens = selfUnits.filter(unit => unit.unitType === QUEEN && unit.labels.has('injector'));
    const nonInjectorUnits = selfUnits.filter(unit => unit.unitType !== QUEEN || !unit.labels.has('injector'));

    if (!worldService.shouldEngage(world, nonInjectorUnits, enemyUnits)) {
      // Non-injector units and necessary queens will form the new selfUnits
      selfUnits = [...nonInjectorUnits, ...getNecessaryQueens(world, injectorQueens, nonInjectorUnits, enemyUnits)];

      // Get all queens that were previously in the selfUnits but not included in the new selfUnits
      const excludedQueens = selfUnits.filter(unit => unit.unitType === QUEEN && !selfUnits.includes(unit));

      // Issue a STOP command for all excluded queens
      excludedQueens.forEach(queen => {
        if (queen.isAttacking() && queen.tag) {  // Add an additional check to ensure queen.tag is defined.
          const stopCommand = {
            abilityId: STOP,
            unitTags: [queen.tag]
          };
          collectedActions.push(stopCommand);
        }
      });
    }

    // Process self units with the appropriate logic
    selfUnits.forEach(selfUnit => {
      processSelfUnitLogic(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks);
    });

    return collectedActions;
  },
  /**
   * @param {World} world
   * @param {Unit[]} workers
   * @param {Unit} closestEnemyUnit
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  getWorkerDefenseCommands: (world, workers, closestEnemyUnit) => {
    const { resources } = world;
    const { units } = resources.get();
    const { stop } = unitService;
    const { getWorkersToDefend, microB } = worldService;
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const collectedActions = [];
    const workersToDefend = getWorkersToDefend(world, workers, closestEnemyUnit);
    workers.forEach(worker => {
      if (worker.labels.get('defending') === false) {
        worker.labels.delete('defending');
        collectedActions.push(...stop([worker]));
      }
    });
    console.log(`Pulling ${workersToDefend.length} to defend with.`);
    workersToDefend.forEach(worker => {
      collectedActions.push(...microB(world, worker, closestEnemyUnit, enemyUnits));
    });
    return collectedActions;
  },
  /**
   * @param {World} world
   * @param {Unit[]} workers
   * @param {Unit} closestEnemyUnit
   * @returns {Unit[]}
   */
  getWorkersToDefend: (world, workers, closestEnemyUnit) => {
    const { resources } = world;
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
   * 
   * @param {World} world 
   * @param {Unit} unit 
  */
  logActionIfNearPosition: (world, unit) => {
    const { resources } = world;
    const { frame } = resources.get();
    const { pos, unitType } = unit; if (pos === undefined || unitType === undefined) { return; }
    worldService.setAndLogExecutedSteps(world, frame.timeInSeconds(), UnitTypeId[unitType], pos);
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
    const enemyUnits = enemyTrackingService.mappedEnemyUnits;
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
      const { position: closestPositionInRange } = closestPosition; if (closestPositionInRange === undefined) return false;
      collectedActions.push(unitCommand);
    } else {
      const inRangeAttackableEnemyUnits = getInRangeAttackableEnemyUnits(data, unit, enemyUnits);
      const enemyUnitsInRangeOfTheirAttack = getEnemyUnitsInRangeOfTheirAttack(data, unit, enemyUnits);
      if (inRangeAttackableEnemyUnits.length === 0) {
        const attackableEnemyUnits = enemyUnits.filter(enemyUnit => canAttack(unit, enemyUnit));
        const closeAttackableEnemyUnits = attackableEnemyUnits.filter(enemyUnit => enemyUnit.pos && getDistanceByPath(resources, pos, enemyUnit.pos) <= 16);
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
      return acc + worldService.getWeaponDPS(world, meleeTargetInRangeFacingUnitType, Alliance.ENEMY, [unitType]);
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
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  microRangedUnit: (world, unit, targetUnit) => {
    const { data } = world;

    if (shouldReturnEarly(unit) || shouldReturnEarly(targetUnit)) {
      return [];
    }

    if (shouldMicro(data, unit, targetUnit)) {
      return getActionsForMicro(world, unit, targetUnit);
    } else {
      // Another function for the logic in the 'else' block. It will make the main function cleaner.
      return getActionsForNotMicro(world, unit, targetUnit);
    }
  },
  /**
   * @param {World} world 
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  premoveBuilderToPosition: (world, position, unitType) => {
    const { getBuildTimeLeft, getPendingOrders } = unitService;
    const { constructionAbilities, gasMineTypes, workerTypes } = groupTypes;
    const { agent, data, resources } = world;
    if (earmarkThresholdReached(data)) return [];
    const { debug, map, units } = resources.get();
    const { getClosestPathablePositionsBetweenPositions, getClosestPositionByPath, getClosestUnitByPath, getDistanceByPath } = resourceManagerService;
    const { rallyWorkerToTarget } = worldService;
    const collectedActions = [];
    position = getMiddleOfStructure(position, unitType);
    const builder = worldService.getBuilder(world, position);
    if (builder) {
      let { unit, timeToPosition, movementSpeedPerSecond } = getBuilderInformation(builder);
      const { orders, pos } = unit; if (orders === undefined || pos === undefined) return collectedActions;
      const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, position);
      const { pathCoordinates, pathableTargetPosition } = closestPathablePositionBetweenPositions;
      if (debug !== undefined) {
        debug.setDrawCells('prmv', getPathCoordinates(MapResourceService.getMapPath(map, pos, pathableTargetPosition)).map(point => ({ pos: point })), { size: 1, cube: false });
      }
      let rallyBase = false;
      let buildTimeLeft = 0;
      const completedBases = units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1);
      const [closestBaseByPath] = getClosestUnitByPath(resources, pathableTargetPosition, completedBases);
      if (closestBaseByPath) {
        const pathablePositions = getPathablePositionsForStructure(map, closestBaseByPath);
        const [pathableStructurePosition] = getClosestPositionByPath(resources, pathableTargetPosition, pathablePositions);
        const baseDistanceToPosition = getDistanceByPath(resources, pathableStructurePosition, pathableTargetPosition);
        const { unitTypeTrainingAbilities } = dataService;
        const workerCurrentlyTraining = closestBaseByPath.orders.findIndex(order => workerTypes.includes(unitTypeTrainingAbilities.get(order.abilityId))) === 0;
        if (workerCurrentlyTraining) {
          const { buildTime } = data.getUnitTypeData(WorkerRace[agent.race]);
          const { progress } = closestBaseByPath.orders[0];
          if (buildTime === undefined || progress === undefined) return collectedActions;
          buildTimeLeft = getBuildTimeLeft(closestBaseByPath, buildTime, progress);
          let baseTimeToPosition = calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond);
          rallyBase = timeToPosition > baseTimeToPosition;
          timeToPosition = rallyBase ? baseTimeToPosition : timeToPosition;
        }
      }
      const pendingConstructionOrder = getPendingOrders(unit).some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
      const unitCommand = builder ? createUnitCommand(MOVE, [unit], pendingConstructionOrder) : {};
      const timeToTargetCost = getTimeToTargetCost(world, unitType);
      const timeToTargetTech = getTimeToTargetTech(world, unitType);
      const timeToTargetCostOrTech = timeToTargetTech > timeToTargetCost ? timeToTargetTech : timeToTargetCost;
      if (shouldPremoveNow(world, timeToTargetCostOrTech, timeToPosition)) {
        if (agent.race === Race.PROTOSS && !gasMineTypes.includes(unitType)) {
          if (pathCoordinates.length >= 2) {
            const secondToLastPosition = pathCoordinates[pathCoordinates.length - 2];
            position = avgPoints([secondToLastPosition, position, position]);
          }
        }
        if (rallyBase) {
          collectedActions.push(...handleRallyBase(world, unit, position));
        } else {
          collectedActions.push(...handleNonRallyBase(world, unit, position, unitCommand, unitType));
        }
      } else {
        collectedActions.push(...rallyWorkerToTarget(world, position, true));
      }
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
    const inRangeEnemySupply = calculateHealthAdjustedSupply(world, getInRangeUnits(targetUnit, [...enemyTrackingService.mappedEnemyUnits]));
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
        collectedActions.push(...micro(world, worker, targetUnit, enemyUnits));
      }
    } else if (worker.isAttacking() && worker.orders.find(order => order.abilityId === ATTACK_ATTACK).targetUnitTag === targetUnit.tag) {
      collectedActions.push(...gatherOrMine(resources, worker));
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} mainCombatTypes 
   * @param {UnitTypeId} supportUnitTypes 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  push: (world, mainCombatTypes, supportUnitTypes) => {
    const { getClosestUnitByPath, getCombatRally, searchAndDestroy } = resourceManagerService;
    const { groupUnits } = unitService;
    const { engageOrRetreat, getDPSHealth } = worldService;
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const { mappedEnemyUnits } = enemyTrackingService;
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    const closestEnemyTarget = closestEnemyBase || getClosestUnitByPath(resources, avgCombatUnitsPoint, mappedEnemyUnits, 1)[0];
    if (closestEnemyTarget) {
      const { pos } = closestEnemyTarget; if (pos === undefined) { return []; }
      const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyTarget, combatUnits));
      if (combatUnits.length > 0) {
        let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
        let selfDPSHealth = allyUnits.reduce((accumulator, unit) => accumulator + getDPSHealth(world, unit, mappedEnemyUnits.map(enemyUnit => enemyUnit.unitType)), 0)
        console.log('Push', selfDPSHealth, closestEnemyTarget['selfDPSHealth']);
        collectedActions.push(...engageOrRetreat(world, allyUnits, mappedEnemyUnits, pos, false));
      }
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
   * @param {Unit} unit 
   * @param {Unit[]} targetUnits 
   * @returns {Point2D|undefined}
   */
  retreat: (world, unit, targetUnits = [], toCombatRally = true) => {
    const { data, resources } = world;
    const { map } = resources.get();
    const { pos } = unit;

    // Early return conditions
    if (!pos || targetUnits.length === 0) return;

    const threats = targetUnits.reduce((/** @type {{ unit: Unit, weapon: SC2APIProtocol.Weapon | undefined, attackRange: number | undefined }[]} */ acc, target) => {
      if (target.unitType !== undefined) {
        const weapon = unitService.getWeaponThatCanAttack(data, target.unitType, unit);
        const attackRange = weapon?.range;
        acc.push({
          unit: target,
          weapon,
          attackRange
        });
      }
      return acc;
    }, []);

    const travelDistancePerStep = 2 * getTravelDistancePerStep(map, unit);
    // Sort threats based on a certain criteria, for this example, based on attack range, descending.
    const sortedThreats = threats.sort((a, b) => (b.attackRange || 0) - (a.attackRange || 0));

    const primaryThreat = sortedThreats[0];

    if (primaryThreat.weapon === undefined || primaryThreat.attackRange === undefined) return;

    if (shouldRetreatToCombatRally(world, unit, primaryThreat.unit, toCombatRally, travelDistancePerStep)) {
      return resourceManagerService.getCombatRally(resources);
    }

    if (shouldRetreatToBunker(resources, pos)) {
      const bunkerPosition = getClosestBunkerPosition(resources, pos);
      return bunkerPosition !== null ? bunkerPosition : undefined;
    }

    if (targetUnits.length > 1) {
      const targetPositions = targetUnits.reduce((/** @type {Point2D[]} */ acc, t) => {
        if (t.pos) {
          acc.push(t.pos);
        }
        return acc;
      }, []);
      return moveAwayFromMultiplePositions(map, targetPositions, pos);
    } else if (targetUnits.length === 1) {
      return determineBestRetreatPoint(world, unit, targetUnits[0], travelDistancePerStep);
    }
  },
  /**
   * @param {World} world 
   */
  runPlan: async (world) => {
    const { agent, data } = world;
    const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return;
    const { build, buildSupplyOrTrain, setFoodUsed, train, upgrade } = worldService;
    if (planService.currentStep > -1) return;
    dataService.earmarks = [];
    planService.pausedThisRound = false;
    planService.pendingFood = 0;
    const { plan } = planService;
    for (let step = 0; step < plan.length; step++) {
      planService.currentStep = step;
      const setEarmark = dataService.earmarks.length === 0;
      const planStep = plan[step];
      await buildSupplyOrTrain(world, planStep);
      const { candidatePositions, orderType, unitType, targetCount, upgrade: upgradeType } = planStep;
      if (orderType === 'UnitType') {
        if (unitType === undefined || unitType === null) break;
        const { attributes } = data.getUnitTypeData(unitType); if (attributes === undefined) break;
        const isStructure = attributes.includes(Attribute.STRUCTURE);
        let { minerals } = agent; if (minerals === undefined) break;
        if (!isStructure) {
          await train(world, unitType, targetCount);
        } else if (isStructure) {
          await build(world, unitType, targetCount, candidatePositions);
        }
      } else if (orderType === 'Upgrade') {
        if (upgradeType === undefined || upgradeType === null) break;
        await upgrade(world, upgradeType);
      }
      setFoodUsed(world);
      if (setEarmark && hasEarmarks(data)) {
        const earmarkTotals = data.getEarmarkTotals('');
        const { minerals: mineralsEarmarked, vespene: vespeneEarmarked } = earmarkTotals;
        const mineralsNeeded = mineralsEarmarked - minerals > 0 ? mineralsEarmarked - minerals : 0;
        const vespeneNeeded = vespeneEarmarked - vespene > 0 ? vespeneEarmarked - vespene : 0;
        balanceResources(world, mineralsNeeded / vespeneNeeded);
      }
    }
    planService.currentStep = -1;
    if (!hasEarmarks(data)) balanceResources(world);
    if (!planService.pausedThisRound) {
      planService.pausePlan = false;
    }
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
   * 
   * @param {World} world
   * @param {number} time 
   * @param {string} name 
   * @param {string | Point2D} notes 
  */
  setAndLogExecutedSteps: (world, time, name, notes = '') => {
    const { agent, data } = world;
    const { minerals, vespene } = agent;
    const { CREEPTUMOR, CREEPTUMORQUEEN } = UnitType;
    let isStructure = false;
    if (UnitType[name]) {
      const { attributes } = data.getUnitTypeData(UnitType[name]); if (attributes === undefined) return;
      isStructure = attributes.includes(Attribute.STRUCTURE);
    }
    const foodUsed = worldService.getFoodUsed();
    const foodCount = (isStructure && agent.race === Race.ZERG) ? foodUsed + 1 : foodUsed;
    const buildStepExecuted = [foodCount, formatToMinutesAndSeconds(time), name, planService.currentStep, worldService.outpowered, `${minerals}/${vespene}`];
    const count = UnitType[name] ? worldService.getUnitCount(world, UnitType[name]) : 0;
    if (count) buildStepExecuted.push(count);
    if (notes) buildStepExecuted.push(notes);
    console.log(buildStepExecuted);
    if ([CREEPTUMOR, CREEPTUMORQUEEN].includes(UnitType[name])) {
      const { creepTumorSteps, creepTumorQueenSteps } = loggingService;
      if (CREEPTUMORQUEEN === UnitType[name]) {
        if (findMatchingStep(creepTumorQueenSteps, buildStepExecuted, isStructure)) {
          loggingService.creepTumorQueenSteps.splice(creepTumorQueenSteps.length - 1, 1, buildStepExecuted)
        } else {
          loggingService.creepTumorQueenSteps.push(buildStepExecuted);
        }
      } else if (CREEPTUMOR === UnitType[name]) {
        if (findMatchingStep(creepTumorSteps, buildStepExecuted, isStructure)) {
          loggingService.creepTumorSteps.splice(creepTumorSteps.length - 1, 1, buildStepExecuted)
        } else {
          loggingService.creepTumorSteps.push(buildStepExecuted);
        }
      }
    } else {
      const { executedSteps } = loggingService;
      if (findMatchingStep(executedSteps, buildStepExecuted, isStructure)) {
        loggingService.executedSteps.splice(executedSteps.length - 1, 1, buildStepExecuted)
      } else {
        loggingService.executedSteps.push(buildStepExecuted);
      }
    }
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
      unit['enemyDPSHealth'] = worldService.calculateNearDPSHealth(world, unit['enemyUnits'], (closestEnemyUnit && closestEnemyUnit['selfUnits']) ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },
  /**
   * @param {World} world
   */
  setFoodUsed: (world) => {
    const { agent } = world;
    const { foodUsed, race } = agent; if (foodUsed === undefined) { return 0; }
    const pendingFoodUsed = race === Race.ZERG ? getWorkers(world).filter(worker => worker.isConstructing()).length : 0;
    const calculatedFoodUsed = foodUsed + planService.pendingFood - pendingFoodUsed;
    worldService.foodUsed = calculatedFoodUsed;
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
      unit['selfDPSHealth'] = worldService.calculateNearDPSHealth(world, unit['selfUnits'], closestEnemyUnit ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
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
      return totalDPSHealth + worldService.calculateNearDPSHealth(world, [unit], unitTypes);
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
      return totalDPSHealth + worldService.calculateNearDPSHealth(world, [unit], enemyCombatUnits.map(enemyCombatUnit => enemyCombatUnit.unitType));
    }, 0);
    worldService.totalSelfDPSHealth += resourceManagerService.getTrainingUnitTypes(resources).reduce((totalDPSHealth, unitType) => {
      return totalDPSHealth + worldService.calculateDPSHealthOfTrainingUnits(world, [unitType], Alliance.SELF, enemyCombatUnits);
    }, 0);
  },
  /**
   * Determines if a group of selfUnits should engage against a group of enemyUnits.
   * @param {World} world
   * @param {Unit[]} selfUnits
   * @param {Unit[]} enemyUnits
   * @returns {boolean}
   */
  shouldEngage: (world, selfUnits, enemyUnits) => {
    const combatantSelfUnits = selfUnits.filter(unitService.potentialCombatants);
    const combatantEnemyUnits = enemyUnits.filter(unitService.potentialCombatants);

    const selfGroupDPS = calculateGroupDPS(world, combatantSelfUnits, combatantEnemyUnits);
    const enemyGroupDPS = calculateGroupDPS(world, combatantEnemyUnits, combatantSelfUnits);
    const selfGroupHealthAndShields = calculateGroupHealthAndShields(combatantSelfUnits);
    const enemyGroupHealthAndShields = calculateGroupHealthAndShields(combatantEnemyUnits);

    // Defensive measures against division by zero
    const dpsRatio = (enemyGroupDPS !== 0) ? selfGroupDPS / enemyGroupDPS : (selfGroupDPS > 0 ? Infinity : 1);
    const healthRatio = (enemyGroupHealthAndShields !== 0) ? selfGroupHealthAndShields / enemyGroupHealthAndShields : (selfGroupHealthAndShields > 0 ? Infinity : 1);

    const dpsThreshold = 1.0;
    const healthThreshold = 1.0;

    return dpsRatio >= dpsThreshold && healthRatio >= healthThreshold;
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
   * Train a unit.
   * @param {World} world The current game world.
   * @param {UnitTypeId} unitTypeId Type of the unit to train.
   * @param {number | null} targetCount Target number of units.
   * @returns {Promise<void>}
   */
  train: async (world, unitTypeId, targetCount = null) => {
    const {
      getPendingOrders, setPendingOrders
    } = unitService;

    const {
      isStrongerAtPosition, canBuild, checkAddOnPlacement, checkUnitCount, getTrainer, getUnitTypeCount, unpauseAndLog
    } = worldService;

    const {
      agent, data, resources
    } = world;

    const { reactorTypes, techLabTypes } = groupTypes;
    const { actions, units } = resources.get();
    const unitTypeData = data.getUnitTypeData(unitTypeId);
    const { abilityId } = unitTypeData;

    if (abilityId === undefined) return;
    const currentUnitTypeCount = getUnitTypeCount(world, unitTypeId);
    let earmarkNeeded = targetCount && currentUnitTypeCount < targetCount;

    const sendCommand = async (/** @type {number} */ ability, /** @type {Unit} */ unit, /** @type {Point2D | null} */ targetPos = null) => {
      const unitCommand = createUnitCommand(ability, [unit]);
      if (targetPos) unitCommand.targetWorldSpacePos = targetPos;
      await actions.sendAction(unitCommand);
      setPendingOrders(unit, unitCommand);
      return unitCommand;
    };

    const setRepositionLabel = (/** @type {Unit} */ unit, /** @type {Point2D} */ position) => {
      unit.labels.set('reposition', position);
      console.log('reposition', position);
    };

    const handleNonWarpgateTrainer = async (/** @type {Unit} */ trainer) => {
      if (trainer.isFlying) {
        const landingPosition = checkAddOnPlacement(world, trainer);
        if (landingPosition) {
          setRepositionLabel(trainer, landingPosition);
          await sendCommand(Ability.LAND, trainer, landingPosition);
        }
      } else {
        await sendCommand(abilityId, trainer);
        unpauseAndLog(world, UnitTypeId[unitTypeId]);
      }
    };

    const selectRandomUnit = (/** @type {Unit[]} */ unitList) => unitList[Math.floor(Math.random() * unitList.length)];

    const handleTechRequirements = (/** @type {Unit} */ unit, /** @type {number} */ techRequirement) => {
      if (!techRequirement) return;

      const matchingAddOnTypes = techLabTypes.includes(techRequirement)
        ? techLabTypes
        : reactorTypes.includes(techRequirement)
          ? reactorTypes
          : [techRequirement];

      const techLabUnits = units.getById(matchingAddOnTypes).filter(unit => unit.unitType !== techRequirement);

      if (techLabUnits.length > 0) {
        const techLab = techLabUnits.reduce((closestTechLab, techLab) => {
          const techLabPos = techLab.pos;
          if (!techLabPos) {
            return closestTechLab;  // return the current closestTechLab if techLabPos is undefined
          }

          const closestTechLabPos = closestTechLab.pos;
          if (!closestTechLabPos) {
            return closestTechLab;  // return the current closestTechLab if closestTechLabPos is undefined
          }

          if (!unit.pos) {
            return closestTechLab;  // return the current closestTechLab if unit.pos is undefined
          }

          return getDistance(techLabPos, unit.pos) < getDistance(closestTechLabPos, unit.pos)
            ? techLab
            : closestTechLab;
        }, techLabUnits[0]);

        if (techLab) {
          const techLabPosition = techLab.pos;
          const [currentBuilding] = units.getClosest(getAddOnBuildingPosition(techLabPosition), units.getStructures().filter(structure => structure.addOnTag === techLab.tag && structure.buildProgress === 1));

          if (currentBuilding) {
            unit.labels.set('reposition', getAddOnBuildingPosition(techLabPosition));
            const [addOnBuilding] = units.getClosest(getAddOnBuildingPosition(techLabPosition), units.getStructures().filter(structure => structure.addOnTag === techLab.tag));
            if (addOnBuilding) {
              addOnBuilding.labels.set('reposition', 'lift');
            }
          }
        }
      }
    };

    const handleUnitBuilding = (/** @type {Unit} */ unit) => {
      const { requireAttached, techRequirement } = unitTypeData;
      if (requireAttached && unit.addOnTag && parseInt(unit.addOnTag) === 0) {
        if (typeof techRequirement !== 'undefined') {
          const matchingAddOnTypes = techLabTypes.includes(techRequirement) ? techLabTypes : reactorTypes.includes(techRequirement) ? reactorTypes : [techRequirement];
          const requiredAddOns = units.getById(matchingAddOnTypes).filter(addOn => {
            const addOnBuilding = units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures().filter(structure => structure.addOnTag === addOn.tag && structure.buildProgress === 1))[0];
            return addOnBuilding && addOnBuilding.noQueue && getPendingOrders(addOnBuilding).length === 0;
          });
          const addOn = selectRandomUnit(requiredAddOns);
          if (addOn) {
            unit.labels.set('reposition', getAddOnBuildingPosition(addOn.pos));
            const addOnBuilding = units.getClosest(getAddOnBuildingPosition(addOn.pos), units.getStructures().filter(structure => structure.addOnTag === addOn.tag))[0];
            if (addOnBuilding) {
              addOnBuilding.labels.set('reposition', 'lift');
            }
          }
        }
      }

      const unitCommand = createUnitCommand(abilityId, [unit]);
      setPendingOrders(unit, unitCommand);
    };

    // Move the logic for determining if a unit can be trained here
    const canTrainUnit = (/** @type {World} */ world, /** @type {number} */ unitTypeId) => {
      return targetCount === null || checkUnitCount(world, unitTypeId, targetCount);
    };

    if (canTrainUnit(world, unitTypeId)) {
      earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
      const trainers = getTrainer(world, unitTypeId);
      const safeTrainers = trainers.filter(trainer => {
        if (trainer.pos) {
          return isStrongerAtPosition(world, trainer.pos);
        }
        return false;
      });
      const randomSafeTrainer = selectRandomUnit(safeTrainers);

      if (randomSafeTrainer && canBuild(world, unitTypeId)) {
        if (randomSafeTrainer.unitType !== WARPGATE) {
          await handleNonWarpgateTrainer(randomSafeTrainer);
        } else {
          unpauseAndLog(world, UnitTypeId[unitTypeId]);
          await resourceManagerService.warpIn(resources, this, unitTypeId);
        }
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`);
        earmarkNeeded = true;
      }

      if (!canBuild(world, unitTypeId)) {
        const { requireAttached, techRequirement } = unitTypeData;
        if (requireAttached || techRequirement) {
          let canDoTypes = data.findUnitTypesWithAbility(abilityId);
          const canDoUnits = units.getById(canDoTypes).filter(unit => unit.abilityAvailable(abilityId));
          let unit = selectRandomUnit(canDoUnits);

          if (!unit && agent.canAfford(unitTypeId)) {
            if (typeof techRequirement === 'number') {
              handleTechRequirements(unit, techRequirement);
            } else {
              // Handle the case where techRequirement is undefined.
              return; // or provide some default logic
            }
          } else if (!unit) {
            const idleUnits = units.getById(canDoTypes).filter(unit => unit.isIdle() && unit.buildProgress === 1);
            const unitToReserve = selectRandomUnit(idleUnits);
            if (unitToReserve) {
              const unitCommand = createUnitCommand(abilityId, [unitToReserve]);
              setPendingOrders(unitToReserve, unitCommand);
            }
          } else {
            handleUnitBuilding(unit);
          }
        }
        earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
      }
    }
    earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitTypeId 
   * @param {number | null} targetCount
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  trainSync: (world, unitTypeId, targetCount = null) => {
    const { warpInSync } = resourceManagerService;
    const { setPendingOrders } = unitService;
    const { addEarmark, canBuild, checkUnitCount, getTrainer, unpauseAndLog, isStrongerAtPosition } = worldService;
    const { WARPGATE } = UnitType;
    const { data } = world;
    const collectedActions = [];

    let { abilityId } = data.getUnitTypeData(unitTypeId);
    if (abilityId === undefined) return collectedActions;

    if (checkUnitCount(world, unitTypeId, targetCount) || targetCount === null) {
      const trainers = getTrainer(world, unitTypeId);

      // Filter trainers based on strength at their position.
      const safeTrainers = trainers.filter(trainer => {
        if (trainer.pos) {
          return isStrongerAtPosition(world, trainer.pos);
        }
        return false;
      });

      // Use a random safe trainer instead of any random trainer.
      const randomSafeTrainer = getRandom(safeTrainers);

      if (randomSafeTrainer) {
        if (canBuild(world, unitTypeId) && randomSafeTrainer) {
          if (randomSafeTrainer.unitType !== WARPGATE) {
            const unitCommand = createUnitCommand(abilityId, [randomSafeTrainer]);
            collectedActions.push(unitCommand);
            setPendingOrders(randomSafeTrainer, unitCommand);
            unpauseAndLog(world, UnitTypeId[unitTypeId]);
          } else {
            collectedActions.push(...warpInSync(world, unitTypeId));
            unpauseAndLog(world, UnitTypeId[unitTypeId]);
          }
          addEarmark(data, data.getUnitTypeData(unitTypeId));
          console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`);
          unitTrainingService.selectedTypeToBuild = null;
        } else {
          addEarmark(data, data.getUnitTypeData(unitTypeId));
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {Boolean}
   */
  shortOnWorkers: (world) => {
    const { gasMineTypes, townhallTypes } = groupTypes;
    const { getById, getClosestPathablePositionsBetweenPositions, getDistanceByPath } = resourceManagerService;
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
                  const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, townhallPos)
                  const { pathablePosition, pathableTargetPosition } = closestPathablePositionBetweenPositions;
                  const distanceByPath = getDistanceByPath(resources, pathablePosition, pathableTargetPosition);
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
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  trainCombatUnits: (world) => {
    const { OVERLORD } = UnitType;
    const { checkProductionAvailability } = worldService;
    const { agent, data, resources } = world;
    const { minerals, vespene } = agent; if (minerals === undefined || vespene === undefined) return [];
    const { units } = resources.get();
    const collectedActions = [];
    const { planMin, trainingTypes, unitMax } = planService;
    const { getExistingTrainingTypes } = unitResourceService;
    const { outpowered, getFoodUsed, getUnitTypeCount, selectTypeToBuild, trainSync } = worldService;
    const { currentStep, plan, legacyPlan } = planService;
    const plannedTrainingTypes = trainingTypes.length > 0 ? trainingTypes : getExistingTrainingTypes(units);
    const candidateTypesToBuild = plannedTrainingTypes.filter(type => {
      const { attributes, foodRequired } = data.getUnitTypeData(type); if (attributes === undefined || foodRequired === undefined) return false;
      const food = plan[currentStep] ? plan[currentStep].food : legacyPlan[currentStep][0];
      if (
        (!attributes.includes(Attribute.STRUCTURE) && type !== OVERLORD) &&
        foodRequired <= food - getFoodUsed() &&
        (
          outpowered ? outpowered : planMin[UnitTypeId[type]] <= getFoodUsed()
        ) &&
        (
          !unitMax[UnitTypeId[type]] || (getUnitTypeCount(world, type) < unitMax[UnitTypeId[type]])
        ) &&
        checkTechFor(agent, type) &&
        checkProductionAvailability(world, type)
      ) {
        return true;
      }
    });
    if (candidateTypesToBuild.length > 0) {
      let { selectedTypeToBuild } = unitTrainingService;
      selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : selectTypeToBuild(world, candidateTypesToBuild);
      if (selectedTypeToBuild !== undefined && selectedTypeToBuild !== null) {
        if (outpowered || agent.canAfford(selectedTypeToBuild)) {
          collectedActions.push(...trainSync(world, selectedTypeToBuild));
        }
      }
      unitTrainingService.selectedTypeToBuild = selectedTypeToBuild;
    }
    return collectedActions;
  },
  /**
   * Trains workers based on the conditions of the world and agent.
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  trainWorkers: (world) => {
    const { getById } = resourceManagerService;
    const { getFoodDifference, haveAvailableProductionUnitsFor, outpowered, unitProductionAvailable, shortOnWorkers } = worldService;
    const { agent: { minerals, race }, resources } = world;

    // Early exit if essential properties are not defined.
    if (minerals === undefined || race === undefined) return [];

    const workerCount = getById(resources, [WorkerRace[race]]).length;
    const assignedWorkerCount = [...resources.get().units.getBases(), ...getById(resources, [GasMineRace[race]])]
      .reduce((acc, base) => (base.assignedHarvesters || 0) + acc, 0);
    const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
    const foodDifference = getFoodDifference(world);
    const sufficientMinerals = minerals < 512 || minimumWorkerCount <= 36;
    const productionPossible = race ? haveAvailableProductionUnitsFor(world, WorkerRace[race]) : false;
    const notOutpoweredOrNoUnits = !outpowered || (outpowered && !unitProductionAvailable);

    let shouldTrainWorkers;

    if (planService.bogIsActive) {
      shouldTrainWorkers = minimumWorkerCount <= 11;
    } else {
      shouldTrainWorkers = sufficientMinerals && (shortOnWorkers(world) || foodDifference > 0)
        && notOutpoweredOrNoUnits && productionPossible;
    }

    // Update the workersTrainingTendedTo flag and potentially add actions to train workers.
    const collectedActions = shouldTrainWorkers
      ? (unitTrainingService.workersTrainingTendedTo = false, [...worldService.buildWorkers(world, foodDifference, true)])
      : (unitTrainingService.workersTrainingTendedTo = true, []);

    return collectedActions;
  },
  /**
   * @description build supply or train units
   * @param {World} world
   * @param {import("../interfaces/plan-step").PlanStep} step
   * @returns {Promise<void>}
   */
  buildSupplyOrTrain: async (world, step) => {
    const { agent, data, resources } = world;
    const { actions } = resources.get();
    const { addEarmark, getFoodUsed, setFoodUsed, trainCombatUnits, trainWorkers } = worldService;

    let foodUsed = getFoodUsed() + getEarmarkedFood();
    const foodUsedLessThanNextStepFoodTarget = step && foodUsed < step.food;

    if (!step || foodUsedLessThanNextStepFoodTarget) {
      await buildSupply(world);

      let trainingOrders = trainWorkers(world);
      if (trainingOrders.length === 0) {
        trainingOrders = trainCombatUnits(world);
      }

      if (trainingOrders.length > 0) {
        await actions.sendAction(trainingOrders);
      } else {
        // get food difference
        foodUsed = getFoodUsed() + getEarmarkedFood();
        const foodDifference = step ? step.food - foodUsed : 0;

        // add earmark for food difference
        for (let i = 0; i < foodDifference; i++) {
          addEarmark(data, data.getUnitTypeData(WorkerRace[agent.race]));
        }
      }
    }
    setFoodUsed(world);
  },
  /**
   * Unpause and log on attempted steps.
   * @param {World} world 
   * @param {string} name 
   * @param {string} extra 
  */
  unpauseAndLog: (world, name, extra = '') => {
    const { agent, resources } = world;
    const { frame } = resources.get();
    if (!(WorkerRace[agent.race] === UnitType[name])) {
      worldService.setAndLogExecutedSteps(world, frame.timeInSeconds(), name, extra);
    }
  },
  /**
   * @param {World} world 
   * @param {number} upgradeId 
   */
  upgrade: async (world, upgradeId) => {
    const { getPendingOrders } = unitService;
    const { addEarmark, setAndLogExecutedSteps } = worldService;
    const { BARRACKS, TECHLAB } = UnitType;
    const { techLabTypes } = groupTypes
    const { agent, data, resources } = world;
    const { upgradeIds } = agent; if (upgradeIds === undefined) return;
    const { actions, frame, units } = resources.get();
    if (upgradeIds.includes(upgradeId)) return;
    const upgraders = units.getUpgradeFacilities(upgradeId).filter(upgrader => upgrader.alliance === Alliance.SELF);
    const upgradeData = data.getUpgradeData(upgradeId);
    const { abilityId } = upgradeData; if (abilityId === undefined) return;
    const upgradeInProgress = upgraders.find(upgrader => upgrader.orders && upgrader.orders.find(order => order.abilityId === abilityId));
    if (upgradeInProgress) return;
    if (agent.canAffordUpgrade(upgradeId)) {
      const upgrader = getRandom(upgraders.filter(upgrader => {
        return upgrader.noQueue && upgrader.abilityAvailable(abilityId);
      }));
      if (upgrader) {
        const unitCommand = createUnitCommand(abilityId, [upgrader]);
        await actions.sendAction([unitCommand]);
        unitService.setPendingOrders(upgrader, unitCommand);
        setAndLogExecutedSteps(world, frame.timeInSeconds(), UpgradeId[upgradeId]);
      } else {
        const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
        if (techLabRequired) {
          const techLabs = units.getAlive(Alliance.SELF).filter(unit => techLabTypes.includes(unit.unitType));
          const orphanTechLabs = techLabs.filter(techLab => {
            const { pos } = techLab; if (pos === undefined) return false;
            const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
            return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), unitResourceService.landingGrids);
          });
          if (orphanTechLabs.length > 0) {
            // get completed and idle barracks
            let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
            let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
            // if no idle barracks, get closest barracks to tech lab.
            const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
            if (barracks.length > 0) {
              let closestPair = [];
              barracks.forEach(barracks => {
                orphanTechLabs.forEach(techLab => {
                  const addOnBuildingPosition = getAddOnBuildingPosition(techLab.pos);
                  if (closestPair.length > 0) {
                    closestPair = distance(barracks.pos, addOnBuildingPosition) < distance(closestPair[0].pos, closestPair[1]) ? [barracks, addOnBuildingPosition] : closestPair;
                  } else { closestPair = [barracks, addOnBuildingPosition]; }
                });
              });
              if (closestPair.length > 0) {
                // if barracks is training unit, cancel training.
                if (isTrainingUnit(data, closestPair[0])) {
                  // for each training unit, cancel training.
                  for (let i = 0; i < closestPair[0].orders.length; i++) {
                    await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                    unitService.setPendingOrders(closestPair[0], createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                  }
                }
                // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
                const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
                const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
                const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
                const distance = getDistance(closestPair[0].pos, closestPair[1]);
                const { movementSpeed } = data.getUnitTypeData(BARRACKSFLYING); if (movementSpeed === undefined) return;
                const movementSpeedPerSecond = movementSpeed * 1.4;
                const timeToMove = distance / movementSpeedPerSecond + (unitService.liftAndLandingTime * 2);
                if (timeUntilUpgradeCanStart < timeToMove) {
                  const label = 'reposition';
                  closestPair[0].labels.set(label, closestPair[1]);
                }
              }
            }
          } else {
            const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
            // find idle building with tech lab.
            const idleBuildingsWithTechLab = nonOrphanTechLabs
              .map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0])
              .filter(building => building.noQueue && getPendingOrders(building).length === 0);
            // find closest barracks to closest tech lab.
            /** @type {Unit[]} */
            let closestPair = [];
            // get completed and idle barracks.
            let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
            let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
            // if no idle barracks, get closest barracks to tech lab.
            const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
            if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
              barracks.forEach(barracks => {
                idleBuildingsWithTechLab.forEach(idleBuildingsWithtechLab => {
                  if (closestPair.length > 0) {
                    closestPair = distance(barracks.pos, idleBuildingsWithtechLab.pos) < distance(closestPair[0].pos, closestPair[1].pos) ? [barracks, idleBuildingsWithtechLab] : closestPair;
                  } else { closestPair = [barracks, idleBuildingsWithtechLab]; }
                });
              });
            }
            if (closestPair.length > 0) {
              const { pos: pos0, orders: orders0 } = closestPair[0]; if (pos0 === undefined || orders0 === undefined) return;
              const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return;
              // if barracks is training unit, cancel training.
              // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
              const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
              const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
              const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
              const distance = getDistance(pos1, pos0);
              if (distance > 0) {
                const { movementSpeed } = data.getUnitTypeData(BARRACKSFLYING); if (movementSpeed === undefined) return;
                const movementSpeedPerSecond = movementSpeed * 1.4;
                const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
                if (timeUntilUpgradeCanStart < timeToMove) {
                  if (isTrainingUnit(data, closestPair[0])) {
                    for (let i = 0; i < orders0.length; i++) {
                      await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                      unitService.setPendingOrders(closestPair[0], createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                    }
                  } else {
                    const label = 'reposition';
                    closestPair[0].labels.set(label, closestPair[1].pos);
                    closestPair[1].labels.set(label, 'lift');
                  }
                }
              }
            }
          }
        }
      }
    } else {
      const techLabRequired = techLabTypes.some(techLabType => UnitAbilityMap[techLabType].some(ability => ability === abilityId));
      if (techLabRequired) {
        const techLabs = units.getAlive(Alliance.SELF).filter(unit => techLabTypes.includes(unit.unitType));
        const orphanTechLabs = techLabs.filter(techLab => {
          const { pos } = techLab; if (pos === undefined) return false;
          const footprint = getFootprint(BARRACKS); if (footprint === undefined) return false;
          return techLab.unitType === TECHLAB && !pointsOverlap(cellsInFootprint(getAddOnBuildingPlacement(pos), footprint), unitResourceService.landingGrids);
        });
        if (orphanTechLabs.length > 0) {
          // get completed and idle barracks
          let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);

          // if no idle barracks, get closest barracks to tech lab.
          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);

          if (barracks.length > 0) {
            let closestPair = [];
            barracks.forEach(barracks => {
              orphanTechLabs.forEach(techLab => {
                const addOnBuildingPosition = getAddOnBuildingPosition(techLab.pos);
                if (closestPair.length > 0) {
                  closestPair = distance(barracks.pos, addOnBuildingPosition) < distance(closestPair[0].pos, closestPair[1]) ? [barracks, addOnBuildingPosition] : closestPair;
                } else { closestPair = [barracks, addOnBuildingPosition]; }
              });
            });
            if (closestPair.length > 0) {
              // if barracks is training unit, cancel training.
              if (isTrainingUnit(data, closestPair[0])) {
                // for each training unit, cancel training.
                for (let i = 0; i < closestPair[0].orders.length; i++) {
                  await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                  unitService.setPendingOrders(closestPair[0], createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                }
              }
              // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
              const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
              const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
              const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
              const distance = getDistance(closestPair[0].pos, closestPair[1]);
              const { movementSpeed } = data.getUnitTypeData(BARRACKSFLYING); if (movementSpeed === undefined) return;
              const movementSpeedPerSecond = movementSpeed * 1.4;
              const timeToMove = distance / movementSpeedPerSecond + (unitService.liftAndLandingTime * 2);
              if (timeUntilUpgradeCanStart < timeToMove) {
                const label = 'reposition';
                closestPair[0].labels.set(label, closestPair[1]);
              }
            }
          }
        } else {
          const nonOrphanTechLabs = techLabs.filter(techLab => techLab.unitType !== TECHLAB);
          // find idle building with tech lab.
          const idleBuildingsWithTechLab = nonOrphanTechLabs
            .map(techLab => units.getClosest(getAddOnBuildingPosition(techLab.pos), units.getAlive(Alliance.SELF), 1)[0])
            .filter(building => building.noQueue && getPendingOrders(building).length === 0);
          // find closest barracks to closest tech lab.
          /** @type {Unit[]} */
          let closestPair = [];
          // get completed and idle barracks.
          let completedBarracks = units.getById(countTypes.get(BARRACKS)).filter(barracks => barracks.buildProgress >= 1);
          let idleBarracks = completedBarracks.filter(barracks => barracks.noQueue);
          // if no idle barracks, get closest barracks to tech lab.
          const barracks = idleBarracks.length > 0 ? idleBarracks : completedBarracks.filter(barracks => isTrainingUnit(data, barracks) && barracks.orders[0].progress <= 0.5);
          if (barracks.length > 0 && idleBuildingsWithTechLab.length > 0) {
            barracks.forEach(barracks => {
              idleBuildingsWithTechLab.forEach(idleBuildingsWithtechLab => {
                if (closestPair.length > 0) {
                  closestPair = distance(barracks.pos, idleBuildingsWithtechLab.pos) < distance(closestPair[0].pos, closestPair[1].pos) ? [barracks, idleBuildingsWithtechLab] : closestPair;
                } else { closestPair = [barracks, idleBuildingsWithtechLab]; }
                if (frame.timeInSeconds() >= 329 && resources.get().frame.timeInSeconds() <= 354) {
                  console.log(`Closest pair currently: [${closestPair[0].pos}, ${closestPair[1].pos}]`);
                }
              });
            });
          }
          if (closestPair.length > 0) {
            const { pos: pos0, orders: orders0 } = closestPair[0]; if (pos0 === undefined || orders0 === undefined) return;
            const { pos: pos1 } = closestPair[1]; if (pos1 === undefined) return;
            // if barracks is training unit, cancel training.
            // Calculate the time until we can afford the upgrade and the time until the required tech becomes available
            const timeUntilCanAfford = getTimeToTargetCost(world, TECHLAB);
            const timeUntilTechAvailable = getTimeToTargetTech(world, TECHLAB);
            const timeUntilUpgradeCanStart = Math.max(timeUntilCanAfford, timeUntilTechAvailable);
            const distance = getDistance(pos1, pos0);
            if (distance > 0) {
              const { movementSpeed } = data.getUnitTypeData(BARRACKSFLYING); if (movementSpeed === undefined) return;
              const movementSpeedPerSecond = movementSpeed * 1.4;
              const timeToMove = distance / movementSpeedPerSecond + (64 / 22.4);
              if (timeUntilUpgradeCanStart < timeToMove) {
                if (isTrainingUnit(data, closestPair[0])) {
                  for (let i = 0; i < orders0.length; i++) {
                    const response = await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                    if (response.result && response.result.find(x => x !== 1)) {
                      console.log('Error cancelling queue');
                    }
                    unitService.setPendingOrders(closestPair[0], createUnitCommand(CANCEL_QUEUE5, [closestPair[0]]));
                  }
                } else {
                  const label = 'reposition';
                  closestPair[0].labels.set(label, closestPair[1].pos);
                  closestPair[1].labels.set(label, 'lift');
                }
              }
            }
          }
        }
      }
    }
    addEarmark(data, upgradeData);
  },
  /**
   * @param {World} world
   * @param {Point2D} position
   * @returns {Unit}
   */
  getWorkerSourceByPath: (world, position) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const { getClosestUnitByPath } = resourceManagerService;
    const { EGG } = UnitType;

    let unitList;
    if (agent.race === Race.ZERG) {
      unitList = getUnitsFromClustering(units.getById(EGG));
    } else {
      unitList = getUnitsFromClustering(units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1));
    }

    const [closestUnitByPath] = getClosestUnitByPath(resources, position, unitList);
    return closestUnitByPath;
  }
}

module.exports = worldService;

/**
 * @param {World} world
 * @param {number} timeToTargetCost 
 * @param {number} timeToPosition 
 * @returns {boolean}
 */
function shouldPremoveNow(world, timeToTargetCost, timeToPosition) {
  const { PYLON } = UnitType;
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const willHaveEnoughMineralsByArrival = timeToTargetCost <= timeToPosition;
  // if race is protoss
  if (agent.race === Race.PROTOSS) {
    const pylons = units.getById(PYLON);
    // get time left for first pylon to warp in
    if (pylons.length === 1) {
      const [pylon] = pylons;
      if (pylon.buildProgress < 1) {
        const timeToFinish = calculateTimeToFinishStructure(data, pylon);
        // if time left for first pylon to warp in is less than time to target cost and time to position, then we should pre-move
        return willHaveEnoughMineralsByArrival && timeToFinish <= timeToPosition;
      } else {
        // ignore in progress pylons beyound first pylon
      }
    } else {
      // if there are more than one pylon or no pylon, then no need to calculate time to finish
    }
  }
  return willHaveEnoughMineralsByArrival;
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 */
function calculateTimeToFinishStructure(data, unit) {
  const { buildProgress } = unit;
  const { buildTime } = data.getUnitTypeData(unit.unitType);
  const timeElapsed = buildTime * buildProgress;
  const timeLeft = getTimeInSeconds(buildTime - timeElapsed);
  return timeLeft;
}
/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findZergPlacements(world, unitType) {
  const { townhallTypes } = groupTypes;
  const { resources } = world;
  const { map, units } = resources.get();
  const candidatePositions = [];
  if (townhallTypes.includes(unitType)) {
    resourceManagerService.availableExpansions = resourceManagerService.availableExpansions.length === 0 ? getAvailableExpansions(resources) : resourceManagerService.availableExpansions;
    const { availableExpansions } = resourceManagerService;
    candidatePositions.push(getNextSafeExpansions(world, availableExpansions)[0]);
  } else {
    const structures = units.getStructures();
    const mineralLinePoints = map.getExpansions().flatMap(expansion => expansion.areas && expansion.areas.mineralLine || []);
    /**
     * @param {Point2D} point
     * @returns {void}
     */
    const processPoint = (point) => {
      const point2D = createPoint2D(point);
      const [closestStructure] = units.getClosest(point2D, structures);
      if (closestStructure.pos && distance(point2D, closestStructure.pos) <= 12.5) {
        const [closestMineralLine] = getClosestPosition(point2D, mineralLinePoints);
        if (distance(point2D, closestMineralLine) > 1.5 && distance(point2D, closestStructure.pos) > 3) {
          candidatePositions.push(point2D);
        }
      }
    };
    if (unitType !== UnitType.NYDUSCANAL) {
      const creepClusters = dbscan(map.getCreep());
      creepClusters.forEach(processPoint);
    } else {
      map.getVisibility().forEach(processPoint);
    }
  }
  return candidatePositions;
}
/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @param {AbilityId} abilityId
 * @return {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function buildWithNydusNetwork(world, unitType, abilityId) {
  const { agent, resources, data } = world;
  const { actions, units } = resources.get();
  const collectedActions = [];
  const nydusNetworks = units.getById(UnitType.NYDUSNETWORK, { alliance: Alliance.SELF });
  if (nydusNetworks.length > 0) {
    // randomly pick a nydus network
    const nydusNetwork = getRandom(nydusNetworks);
    if (agent.canAfford(unitType)) {
      if (await actions.canPlace(unitType, [planService.foundPosition])) {
        const unitCommand = createUnitCommand(abilityId, [nydusNetwork]);
        unitCommand.targetWorldSpacePos = planService.foundPosition;
        collectedActions.push(unitCommand);
        planService.pausePlan = false;
        planService.continueBuild = true;
        worldService.addEarmark(data, data.getUnitTypeData(unitType));
        planService.foundPosition = null;
      } else {
        planService.foundPosition = null;
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
  }
  return collectedActions;
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {SC2APIProtocol.Weapon | undefined}
 **/
function getWeapon(data, unit, targetUnit) {
  const { getWeaponThatCanAttack } = unitService;
  const { unitType } = unit;
  if (!unitType) return undefined;
  if (unitType === UnitType.SENTRY) {
    return {
      attacks: 1,
      damage: 6,
      damageBonus: [],
      range: 5,
      speed: 1,
      type: WeaponTargetType.ANY,
    }
  } else {
    return getWeaponThatCanAttack(data, unitType, targetUnit);
  }
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @param {number} radius
 * @returns {Point2D[]}
 **/
function getSafePositions(world, unit, targetUnit, radius = 0.5) {
  const { resources } = world;
  const { map, units } = resources.get();
  let safePositions = [];
  const { pos } = unit; if (pos === undefined || radius === undefined) return safePositions;
  const { x, y } = pos; if (x === undefined || y === undefined) return safePositions;
  const { pos: targetPos } = targetUnit; if (targetPos === undefined) return safePositions;
  const { x: targetX, y: targetY } = targetPos; if (targetX === undefined || targetY === undefined) return safePositions;
  const { mappedEnemyUnits } = enemyTrackingService;
  const enemyUnits = mappedEnemyUnits.filter(enemyUnit => {
    // Check if the unit has a position and is not a peaceful worker
    if (!enemyUnit.pos || resourceManagerService.isPeacefulWorker(resources, enemyUnit)) {
      return false;
    }

    // Check if the unit is within a certain range
    if (distance(pos, enemyUnit.pos) > 16) {
      return false;
    }

    // Check if the unit can attack the worker
    return canAttack(enemyUnit, unit);
  });

  // get the angle to the target enemy unit
  let angleToEnemy = Math.atan2(targetY - y, targetX - x);
  let startAngle = angleToEnemy + Math.PI - Math.PI / 2; // 180 degree cone
  let endAngle = angleToEnemy + Math.PI + Math.PI / 2;

  while (safePositions.length === 0 && radius <= 16) {
    for (let i = startAngle; i < endAngle; i += 2.5 * Math.PI / 180) {  // Half the original step size
      const { x, y } = pos;
      if (x === undefined || y === undefined) return safePositions;
      const point = {
        x: x + radius * Math.cos(i),
        y: y + radius * Math.sin(i),
      };
      if (existsInMap(map, point) && map.isPathable(point)) {
        const [closestEnemyUnit] = units.getClosest(point, enemyUnits, 1);
        if (closestEnemyUnit && closestEnemyUnit.pos && distance(point, closestEnemyUnit.pos) > distance(pos, closestEnemyUnit.pos)) {
          const pointWithHeight = { ...point, z: map.getHeight(point) };
          const safePositionFromTargets = isSafePositionFromTargets(map, unit, enemyUnits, pointWithHeight);
          if (safePositionFromTargets) {
            safePositions.push(point);
          }
        }
      }
    }
    radius += 0.5;  // Increment radius by smaller steps
  }

  // Get the worker's destination
  const workerDestination = unitResourceService.getOrderTargetPosition(units, unit);

  // If workerDestination is defined, then sort the safe positions based on their proximity to the worker's destination
  if (workerDestination) {
    safePositions.sort((a, b) => {
      const distanceA = distance(a, workerDestination);
      const distanceB = distance(b, workerDestination);
      return distanceA - distanceB; // Sorting in ascending order of distance to worker's destination
    });
  }

  return safePositions;
}
/**
 * @param {MapResource} map
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits
 * @param {Point3D} point 
 * @returns {boolean}
 */
function isSafePositionFromTargets(map, unit, targetUnits, point) {
  const { getHighestRangeWeapon } = unitService;
  if (!existsInMap(map, point)) return false;
  let weaponTargetType = null;
  const { pos, radius } = unit;
  if (pos === undefined || radius === undefined) return false;
  if (point.z === undefined || pos === undefined || pos.z === undefined) return false;
  if (point.z > pos.z + 2) {
    weaponTargetType = WeaponTargetType.AIR;
  } else {
    weaponTargetType = WeaponTargetType.GROUND;
    // return false if point is outside of map and point is not pathable
    if (!map.isPathable(point)) return false;
  }
  return targetUnits.every((targetUnit) => {
    const { pos } = targetUnit;
    if (pos === undefined || targetUnit.radius === undefined) return true;
    const weapon = getHighestRangeWeapon(targetUnit, weaponTargetType);
    if (weapon === undefined || weapon.range === undefined) return true;
    const weaponRange = weapon.range;
    const distanceToTarget = distance(point, pos);
    const safeDistance = (weaponRange + radius + targetUnit.radius + getTravelDistancePerStep(map, targetUnit) + getTravelDistancePerStep(map, unit));
    return distanceToTarget > safeDistance;
  });
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {(import("../interfaces/retreat-candidate").RetreatCandidate)[]}
 */
function getRetreatCandidates(world, unit, targetUnit) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { centroid } = map.getMain();
  const { pos, radius: unitRadius = 0 } = unit;

  if (!centroid || !pos) return [];

  const expansionLocations = getCentroids(map.getExpansions());
  const damageDealingEnemies = worldService.getDamageDealingUnits(
    world,
    unit,
    targetUnit['selfUnits'] || getEnemyUnits(targetUnit)
  );

  const safeExpansionLocations = expansionLocations.filter(location => {
    return isPathSafe(world, unit, location);
  });

  if (damageDealingEnemies.length === 0 && safeExpansionLocations.length > 0) {
    return mapToRetreatCandidates(resources, safeExpansionLocations, pos);
  }

  const unitsFromClustering = getUnitsFromClustering(damageDealingEnemies);

  return expansionLocations.flatMap(point => {
    const closestEnemy = resourceManagerService.getClosestEnemyByPath(resources, point, unitsFromClustering);
    if (!closestEnemy || !closestEnemy.unitType) return [];

    const { pos: enemyPos, radius: enemyRadius = 0, unitType } = closestEnemy;

    if (!enemyPos || typeof enemyPos.x !== 'number' || typeof enemyPos.y !== 'number') return [];

    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit);
    const attackRange = (weapon?.range || 0) + unitRadius + enemyRadius;

    const point2D = { x: enemyPos.x, y: enemyPos.y };
    const adjustedDistanceToEnemy = calculateDistances(resources, point2D, getPathablePositions(map, point)).distance - attackRange;
    const distanceToRetreat = calculateDistances(resources, pos, getPathablePositions(map, point)).distance;

    const expansionsInPath = getExpansionsInPath(map, pos, point);
    const pathToRetreat = expansionsInPath.reduce((/** @type {Point2D[]} */ acc, expansion) => {
      if (map.isPathable(expansion.townhallPosition)) {
        acc.push(expansion.townhallPosition);
      } else {
        const nearbyPathable = findNearbyPathablePosition(world, expansion.townhallPosition);
        if (nearbyPathable) acc.push(nearbyPathable); // Only push if a pathable position was found
      }
      return acc;
    }, []);

    const safeToRetreat = isSafeToRetreat(world, unit, pathToRetreat, point);

    if (distanceToRetreat !== Infinity && distanceToRetreat < adjustedDistanceToEnemy && safeToRetreat) {
      return mapToRetreatCandidates(resources, [point], pos);
    }
    return [];
  });
}
/**
 * @param {ResourceManager} resources
 * @param {Point2D[]} expansionLocations
 * @param {Point2D} pos
 * @return {import("../interfaces/retreat-candidate").RetreatCandidate[]}
 */
function mapToRetreatCandidates(resources, expansionLocations, pos) {
  const { map } = resources.get();
  return expansionLocations.map(point => {
    const { distance } = calculateDistances(resources, pos, getPathablePositions(map, point));
    return {
      point,
      safeToRetreat: true,
      expansionsInPath: getCentroids(getExpansionsInPath(map, pos, point)),
      getDistanceByPathToRetreat: distance,
      getDistanceByPathToTarget: distance,
      closerOrEqualThanTarget: true,
    };
  });
}

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit 
 * @returns {Unit}
 */
function getUnitForDPSCalculation(resources, unit) {
  const { units } = resources.get();
  const { getDistanceByPath } = resourceManagerService;
  const { ADEPT, ADEPTPHASESHIFT } = UnitType;
  if (unit.unitType === ADEPTPHASESHIFT) {
    const label = 'ADEPT';
    if (unit.hasLabel(label)) {
      unit = getByTag(unit.getLabel(label));
    } else {
      // find the closest ADEPT that has not been assigned to unit
      const [closestAdept] = getUnitsByAllianceAndType(unit.alliance, ADEPT).filter(adept => {
        // return true if adept.tag does not exist in units.withLabel('ADEPT');
        return !units.withLabel(label).some(unit => unit.labels.get(label) === adept.tag);
      }).sort((a, b) => getDistanceByPath(resources, a.pos, unit.pos) - getDistanceByPath(resources, b.pos, unit.pos));
      if (closestAdept) {
        unit.labels.set(label, closestAdept.tag);
        console.log(`${unit.unitType} ${unit.tag} assigned to ${closestAdept.unitType} ${closestAdept.tag}`);
      }
      return closestAdept;
    }
  }
  return unit;
}
/**
 * 
 * @param {SC2APIProtocol.Alliance} alliance
 * @param {UnitTypeId} unitType 
 * @returns {Unit[]}
 */
function getUnitsByAllianceAndType(alliance, unitType) {
  if (alliance === Alliance.SELF) {
    return trackUnitsService.selfUnits.filter(unit => unit.unitType === unitType);
  } else if (alliance === Alliance.ENEMY) {
    return enemyTrackingService.mappedEnemyUnits.filter(unit => unit.unitType === unitType);
  } else {
    return [];
  }
}
/**
 * @param {string} tag 
 * @returns {Unit}
 */
function getByTag(tag) {
  return enemyTrackingService.mappedEnemyUnits.find(unit => unit.tag === tag);
}
/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 **/
function getTimeToTargetCost(world, unitType) {
  const { agent, data, resources } = world;
  const { minerals } = agent; if (minerals === undefined) return Infinity;
  const { frame } = resources.get();
  const { score } = frame.getObservation(); if (score === undefined) return Infinity;
  const { scoreDetails } = score; if (scoreDetails === undefined) return Infinity;
  const collectionRunup = frame.getGameLoop() < 292;
  let { collectionRateMinerals, collectionRateVespene } = scoreDetails; if (collectionRateMinerals === undefined || collectionRateVespene === undefined) return Infinity;
  if (collectionRunup) {
    collectionRateMinerals = 615;
    collectionRateVespene = 0;
  }
  worldService.addEarmark(data, data.getUnitTypeData(unitType));
  let earmarkTotals = data.getEarmarkTotals('');
  const { minerals: earmarkMinerals, vespene: earmarkVespene } = earmarkTotals;
  const mineralsLeft = earmarkMinerals - minerals;
  const vespeneLeft = earmarkVespene - agent.vespene;
  const mineralCollectionRate = collectionRateMinerals / 60;
  if (mineralCollectionRate === 0) return Infinity;
  const timeToTargetMinerals = mineralsLeft / mineralCollectionRate;
  const { vespeneCost } = data.getUnitTypeData(unitType); if (vespeneCost === undefined) return Infinity;
  const vespeneCollectionRate = collectionRateVespene / 60;
  let timeToTargetVespene = 0;
  if (vespeneCost > 0) {
    if (vespeneCollectionRate === 0) {
      return Infinity;
    } else {
      timeToTargetVespene = vespeneLeft / vespeneCollectionRate;
    }
  }
  return Math.max(timeToTargetMinerals, timeToTargetVespene);
}
/**
 * @param {UnitResource} units
 * @param {SC2APIProtocol.Weapon} weapon
 * @param {UnitTypeId} targetUnitType
 * @returns {boolean}
 **/
function canWeaponAttackType(units, weapon, targetUnitType) {
  const { getUnitTypeData } = unitResourceService;
  const { isFlying } = getUnitTypeData(units, targetUnitType);
  return weapon.type === WeaponTargetType.ANY || (weapon.type === WeaponTargetType.GROUND && !isFlying) || (weapon.type === WeaponTargetType.AIR && isFlying || targetUnitType === UnitType.COLOSSUS);
}
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
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 */
function inCombatRange(world, unit, targetUnit) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit;
  if (pos === undefined || radius === undefined || unitType === undefined) return false;
  const { pos: targetPos, radius: targetRadius } = targetUnit;
  if (targetPos === undefined || targetRadius === undefined) return false;
  const { weapons } = targetUnit.data();
  if (weapons === undefined) return false;
  const weapon = getWeaponThatCanAttack(data, unitType, targetUnit);
  if (weapon === undefined) return false;
  const { range } = weapon;
  if (range === undefined) return false;
  return distance(pos, targetPos) <= range + radius + targetRadius + getTravelDistancePerStep(map, targetUnit) + getTravelDistancePerStep(map, unit);
}
/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
function getTimeToTargetTech(world, unitType) {
  const { data, resources } = world;
  const { units } = resources.get();
  const unitTypeData = data.getUnitTypeData(unitType);
  const { techRequirement } = unitTypeData;
  if (techRequirement === undefined || techRequirement === 0) return 0;
  const { buildTime } = data.getUnitTypeData(techRequirement);
  if (buildTime === undefined) return 0;

  // Check for morphed units which still meet tech requirement
  const possibleTechUnits = countTypes.has(techRequirement) ? countTypes.get(techRequirement) : [techRequirement];
  if (possibleTechUnits !== undefined) {
    const [techUnit] = units.getById(possibleTechUnits).sort((a, b) => {
      const { buildProgress: buildProgressA } = a;
      const { buildProgress: buildProgressB } = b;
      if (buildProgressA === undefined || buildProgressB === undefined) return 0;
      return buildProgressB - buildProgressA;
    });
    if (techUnit !== undefined) {
      const { buildProgress } = techUnit;
      if (buildProgress !== undefined) {
        return getTimeInSeconds((1 - buildProgress) * buildTime);
      }
    }
  }

  return 0;
}
/**
 * @param {Unit} builder
 */
function setBuilderLabel(builder) {
  builder.labels.set('builder', true);
  if (builder.labels.has('mineralField')) {
    const mineralField = builder.labels.get('mineralField');
    if (mineralField) {
      mineralField.labels.set('workerCount', mineralField.labels.get('workerCount') - 1);
      builder.labels.delete('mineralField');
    }
  }
}
/**
 * 
 * @param {Unit} unit 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopUnitFromMovingToPosition(unit, position) {
  const collectedActions = [];
  const { orders } = unit;
  if (orders === undefined) return collectedActions;
  if (orders.length > 0) {
    const { targetWorldSpacePos } = orders[0];
    if (targetWorldSpacePos === undefined) return collectedActions;
    const distanceToTarget = distance(targetWorldSpacePos, position);
    if (distanceToTarget < 1) {
      collectedActions.push(createUnitCommand(STOP, [unit]));
    }
  }
  return collectedActions;
}
/**
 * @param {(string | number | boolean | undefined)[][]} steps
 * @param {(string | number | boolean | undefined)[]} buildStepExecuted
 * @param {boolean} isStructure
 * @returns {boolean}
 */
function findMatchingStep(steps, buildStepExecuted, isStructure) {
  const lastElement = steps.length - 1;
  const lastStep = steps[lastElement];
  let foundMatchingStep = false;
  if (lastStep) {
    foundMatchingStep = buildStepExecuted[2] === lastStep[2] && buildStepExecuted[6] === lastStep[6];
    if (foundMatchingStep && !isStructure) {
      foundMatchingStep = foundMatchingStep && buildStepExecuted[3] === lastStep[3];
    }
  }
  return foundMatchingStep
}

/**
 * @param {Unit[]} units
 * @param {Point2D} position
 * @param {number} range
 * @returns {Unit[]}
 */
function getUnitsInRangeOfPosition(units, position, range) {
  return units.filter(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    return getDistance(pos, position) <= range;
  });
}
/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getContructionTimeLeft(world, unit, inSeconds = true) {
  const { getBuildTimeLeft } = unitService;
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos, targetUnitTag } = constructingOrder; if (targetWorldSpacePos === undefined && targetUnitTag === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && dataService.unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  let targetPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined; if (targetPosition === undefined) return 0;
  // @ts-ignore
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && distance(unit.pos, targetPosition) < 1);
  const { buildTime } = data.getUnitTypeData(unitTypeBeingConstructed); if (buildTime === undefined) return 0;
  if (unitAtTargetPosition !== undefined) {
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
  } else {
    buildTimeLeft = buildTime;
  }
  if (inSeconds) {
    return getTimeInSeconds(buildTimeLeft);
  }
  return buildTimeLeft;
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 */
function haveSupplyForUnit(world, unitType) {
  const { agent, data } = world;
  const { foodCap } = agent; if (foodCap === undefined) return false;
  const foodUsed = worldService.getFoodUsed();
  const earmarkedFood = dataService.getEarmarkedFood();
  const { foodRequired } = data.getUnitTypeData(unitType); if (foodRequired === undefined) return false;
  const supplyLeft = foodCap - foodUsed - earmarkedFood - foodRequired;
  return supplyLeft >= 0;
}
/**
 * @param {World} world
 * @returns {Promise<void>} 
 */
async function buildSupply(world) {
  const { OVERLORD, PYLON, SUPPLYDEPOT } = UnitType;
  const { agent } = world;
  const { foodUsed, minerals } = agent; if (foodUsed === undefined || minerals === undefined) return;
  const { build, isSupplyNeeded, findPlacements, train } = worldService;
  const greaterThanPlanSupply = foodUsed > planService.planMax.supply;
  const conditions = [
    isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512) &&
    planService.automateSupply,
  ];
  if (conditions.some(condition => condition)) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositions = findPlacements(world, SUPPLYDEPOT);
        await build(world, SUPPLYDEPOT, null, candidatePositions);
        break;
      }
      case Race.PROTOSS: {
        const candidatePositions = findPlacements(world, PYLON);
        await build(world, PYLON, null, candidatePositions);
        break;
      }
      case Race.ZERG: await train(world, OVERLORD); break;
    }
  }
}
/**
 * @param {World} world
 * @returns {Unit[]}
 */
function getWorkers(world) {
  const { agent, resources } = world;
  const { race } = agent; if (race === undefined) return [];
  return resourceManagerService.getById(resources, [groupTypes.workerTypes[race]])
}

/**
 * @param {MapResource} map
 * @param {Unit} structure
 * @param {boolean} isPathable
 * @returns {void}
 * @description Sets the pathable grid for a structure.
 */
function setPathableGrids(map, structure, isPathable) {
  const { pos, unitType } = structure; if (pos === undefined || unitType === undefined) return;
  const footprint = getFootprint(unitType); if (footprint === undefined) return;
  cellsInFootprint(createPoint2D(pos), footprint).forEach(cell => map.setPathable(cell, isPathable));
}

/**
 * @param {UnitResource} units
 * @param {Point2D} movingPosition
 * @returns {Unit | undefined}
 * @description Returns the structure at the given position.
 */
function getStructureAtPosition(units, movingPosition) {
  return units.getStructures().find(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    return distance(pos, movingPosition) < 1;
  });
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @param {Unit} targetUnit
 * @returns {boolean}
 */
function shouldMicro(data, unit, targetUnit) {
  const { enemyUnitsPositions } = enemyTrackingService;
  const { pos, radius, unitType, weaponCooldown } = unit; if (pos === undefined || radius === undefined || unitType === undefined || weaponCooldown === undefined) return false;
  const { pos: targetPos, radius: targetRadius, tag } = targetUnit; if (targetPos === undefined || targetRadius === undefined || tag === undefined) return false;
  const weaponCooldownOverStepSize = weaponCooldown > 8;
  const targetPositions = enemyUnitsPositions.get(tag);
  let projectedTargetPosition = targetPositions !== undefined && getProjectedPosition(targetPositions.current.pos, targetPositions.previous.pos, targetPositions.current.lastSeen, targetPositions.previous.lastSeen);
  projectedTargetPosition = projectedTargetPosition ? projectedTargetPosition : targetPos;
  const weapon = getWeapon(data, unit, targetUnit); if (weapon === undefined) return false;
  const { range } = weapon; if (range === undefined) return false;
  const distanceToProjectedPosition = getDistance(projectedTargetPosition, pos);
  const isProjectedPositionInRange = distanceToProjectedPosition < (range + radius + targetRadius);
  return (weaponCooldownOverStepSize || unitType === UnitType.CYCLONE) && isProjectedPositionInRange;
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
 * @description Returns projected position of unit.
 * @param {Point2D} pos
 * @param {Point2D} pos1
 * @param {number} time
 * @param {number} time1
 * @param {number} [stepSize=8]
 * @returns {Point2D}
 */
function getProjectedPosition(pos, pos1, time, time1, stepSize = 8) {
  const { x, y } = pos; if (x === undefined || y === undefined) return pos;
  const { x: x1, y: y1 } = pos1; if (x1 === undefined || y1 === undefined) return pos;
  const timeDiff = time1 - time;
  if (timeDiff === 0) return pos;
  const adjustedTimeDiff = timeDiff / stepSize;
  const xDiff = x1 - x;
  const yDiff = y1 - y;
  const projectedPosition = {
    x: x + xDiff / adjustedTimeDiff,
    y: y + yDiff / adjustedTimeDiff,
  };
  return projectedPosition;
}

/**
 * @description calculates the time it takes to kill the target unit
 * @param {World} world
 * @param {Unit[]} fighters
 * @param {Unit[]} targetUnits
 * @returns {number}
 */
function getTimeToKill(world, fighters, targetUnits) {
  const { getWeaponDPS } = worldService;
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
 * @param {Unit} selfUnit
 * @param {Unit} targetUnit
 * @param {number} selfDPSHealth
 * @returns {void}
 */
function logBattleFieldSituation(world, selfUnit, targetUnit, selfDPSHealth) {
  const selfOverEnemyDPSHealth = `${Math.round(selfDPSHealth)}/${Math.round(getSelfDPSHealth(world, targetUnit))}`;
  if (selfUnit.pos === undefined || targetUnit.pos === undefined) return;
  const distanceFromEnemy = distance(selfUnit.pos, targetUnit.pos);
  const selfOverEnemyUnitType = `${selfUnit.unitType}/${targetUnit.unitType}`;
  console.log('selfOverEnemyDPSHealth', selfOverEnemyDPSHealth, 'distanceFromEnemy', distanceFromEnemy, 'selfOverEnemyUnitType', selfOverEnemyUnitType)
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @returns {Boolean}
 */
function isEnemyInAttackRange(data, unit, targetUnit) {
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit;
  if (!pos || !radius || !unitType || !targetUnit.pos || !targetUnit.radius) return false;
  // check if properties exist
  const foundWeapon = getWeaponThatCanAttack(data, unitType, targetUnit);
  return foundWeapon && foundWeapon.range ? (foundWeapon.range >= distance(pos, targetUnit.pos) + radius + targetUnit.radius) : false;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit|null}
 */
function getClosestEnemyByRange(world, unit, enemyUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { getWeaponThatCanAttack } = unitService;
  let shortestDifference = Number.MAX_VALUE;
  return enemyUnits.reduce((closestEnemyByRange, enemyUnit) => {
    const weapon = getWeaponThatCanAttack(data, enemyUnit.unitType, unit);
    if (weapon) {
      const range = weapon.range + unit.radius + enemyUnit.radius + getTravelDistancePerStep(map, enemyUnit);
      const distanceToUnit = distance(unit.pos, enemyUnit.pos);
      const difference = distanceToUnit - range;
      if (difference < shortestDifference) {
        shortestDifference = difference;
        closestEnemyByRange = enemyUnit;
      }
    }
    return closestEnemyByRange;
  });
}

/**
 * @param {Unit} unit 
 * @param {Point2D} position 
 */
function setRecruitToBattleLabel(unit, position) {
  unit['selfUnits'].forEach((/** @type {Unit} */ selfUnit) => {
    if (distance(selfUnit.pos, position) > 16) {
      if (selfUnit.isWorker()) {
        if (selfUnit.isHarvesting() || selfUnit.isConstructing() || selfUnit.labels.has('retreating')) {
          return;
        }
      }
      selfUnit.labels.set('recruitToBattle', position);
    }
  });
}

/**
 * @param {World} world
 * @returns {{unitType: number, timeLeft: number}[]}
 * @description returns unit types that are training, with time left to train
 */
function getUnitsTraining(world) {
  const { getBuildTimeLeft } = unitService;
  const { data, resources } = world;
  const { units } = resources.get();
  const unitsWithOrders = units.getAlive(Alliance.SELF).filter(unit => unit.orders !== undefined && unit.orders.length > 0);
  return unitsWithOrders.reduce((/** @type {{unitType: number, timeLeft: number}[]} */ acc, unit) => {
    const { orders } = unit; if (orders === undefined) return acc;
    /** @type {{abilityId: number | undefined, progress: number | undefined}[]} */
    const mappedOrders = orders.map(order => ({ abilityId: order.abilityId, progress: order.progress }));
    mappedOrders.forEach(({ abilityId, progress }) => {
      if (abilityId === undefined || progress === undefined) return acc;
      const unitType = dataService.unitTypeTrainingAbilities.get(abilityId);
      if (unitType !== undefined) {
        const { attributes, buildTime } = data.getUnitTypeData(unitType); if (attributes === undefined || buildTime === undefined) return acc;
        if (attributes.includes(Attribute.STRUCTURE)) return acc;
        const timeLeft = getBuildTimeLeft(unit, buildTime, progress);
        acc.push({ unitType, timeLeft });
      }
    });
    return acc;
  }, []);
}

/**
 * @param {World} world
 * @param {UnitTypeId[]} unitTypesTraining
 * @param {Unit[]} threats
 * @returns {{timeToKill: number, timeToBeKilled: number}}
 */
function calculateTimeToKillForTrainingUnits(world, unitTypesTraining, threats) {
  const { getWeaponDPS } = worldService;
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
 * 
 * @param {ResourceManager} resources 
 * @param {Point2D} position
 * @param {Point2D} targetPosition
 * @returns {Unit | undefined}
 * @description returns closest safe mineral field to position
 */
function getClosestSafeMineralField(resources, position, targetPosition) {
  const { map, units } = resources.get();
  return map.getExpansions().reduce((/** @type {Unit | undefined} */ acc, expansion) => {
    const { areas, cluster, townhallPosition } = expansion; if (areas === undefined || cluster === undefined) return acc;
    const { mineralLine } = areas; if (mineralLine === undefined) return acc;
    const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(townhallPosition, mineralField.pos) < 14);
    const averageMineralLinePosition = avgPoints(mineralLine);
    const distancePositionToMineralLine = getDistanceByPath(resources, position, averageMineralLinePosition);
    const distanceTargetToMineralLine = getDistanceByPath(resources, targetPosition, averageMineralLinePosition);
    if (distancePositionToMineralLine < distanceTargetToMineralLine) {
      const [closestMineralField] = mineralFields;
      return closestMineralField;
    }
    return acc;
  }, undefined);
}

/**
 * @param {World} world
 * @param {Unit[]} selfUnits
 * @param {Unit[]} enemyUnits
 * @returns {{timeToKill: number, timeToBeKilled: number}}
 */
function calculateTimeToKill(world, selfUnits, enemyUnits) {
  const { getWeaponDPS } = worldService;

  if (selfUnits.length === 0) {
    return { timeToKill: Infinity, timeToBeKilled: 0 };
  }

  if (enemyUnits.length === 0) {
    return { timeToKill: 0, timeToBeKilled: Infinity };
  }

  const timeToKill = enemyUnits.reduce((timeToKill, threat) => {
    const { health, shield, unitType } = threat; if (health === undefined || shield === undefined || unitType === undefined) return timeToKill;
    const totalHealth = health + shield;
    const totalWeaponDPS = selfUnits.reduce((totalWeaponDPS, unit) => {
      const { unitType } = unit; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.SELF, enemyUnits.map(threat => threat.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToKillCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToKill === Infinity) ? timeToKillCurrent : timeToKill + timeToKillCurrent;
  }, Infinity);
  const timeToBeKilled = selfUnits.reduce((timeToBeKilled, unit) => {
    const { health, shield, unitType } = unit; if (health === undefined || shield === undefined || unitType === undefined) return timeToBeKilled;
    const totalHealth = health + shield;
    const totalWeaponDPS = enemyUnits.reduce((totalWeaponDPS, threat) => {
      const { unitType } = threat; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.ENEMY, selfUnits.map(unit => unit.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);
  return { timeToKill, timeToBeKilled };
}

/**
 * @param {World} world
 * @param {Unit[]} units
 * @returns {Unit[]}
 * @description returns units that are attacking something in range
 */
function getUnitsAttackingInRange(world, units) {
  const { data, resources } = world;
  const { units: unitsResource } = resources.get();
  const { getWeaponThatCanAttack } = unitService;
  return units.filter(unit => {
    if (unit.isAttacking()) {
      const { orders, pos, radius, unitType } = unit; if (orders === undefined || pos === undefined || radius === undefined || unitType === undefined) { return false; }
      const attackingOrder = orders.find(order => order.abilityId === ATTACK_ATTACK); if (attackingOrder === undefined) { return false; }
      const { targetUnitTag } = attackingOrder; if (targetUnitTag === undefined) { return false; }
      const targetUnit = unitsResource.getByTag(targetUnitTag); if (targetUnit === undefined) { return false; }
      const { pos: targetPos, radius: targetRadius } = targetUnit; if (targetPos === undefined || targetRadius === undefined) { return false; }
      const weapon = getWeaponThatCanAttack(data, unitType, targetUnit); if (weapon === undefined) { return false; }
      const { range } = weapon; if (range === undefined) { return false; }
      const shootingRange = range + radius + targetRadius;
      return distance(pos, targetPos) < shootingRange;
    }
  });
}

/**
 * 
 * @param {Unit[]} units
 * @returns {Unit[]}
 */
function getUnitsFromClustering(units) {
  // Perform clustering on builderCandidates
  let unitPoints = units.reduce((/** @type {Point2D[]} */accumulator, builder) => {
    const { pos } = builder; if (pos === undefined) return accumulator;
    accumulator.push(pos);
    return accumulator;
  }, []);
    // Apply DBSCAN to get clusters
  const clusters = dbscan(unitPoints);
  // Find the closest builderCandidate to each centroid
  let closestUnits = clusters.reduce((/** @type {Unit[]} */acc, builderCandidateCluster) => {
    let closestBuilderCandidate;
    let shortestDistance = Infinity;
    for (let unit of units) {
      const { pos } = unit; if (pos === undefined) return acc;
      let distance = getDistance(builderCandidateCluster, pos);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        closestBuilderCandidate = unit;
      }
    }
    if (closestBuilderCandidate) {
      acc.push(closestBuilderCandidate);
    }
    return acc;
  }, []);
  return closestUnits;
}

/**
 * 
 * @param {{unit: Unit, timeToPosition: number }} builder
 * @returns {{unit: Unit, timeToPosition: number, movementSpeedPerSecond: number }}
 */
const getBuilderInformation = (builder) => {
  let { unit, timeToPosition } = builder;
  const { movementSpeed } = unit.data();
  const movementSpeedPerSecond = movementSpeed ? movementSpeed * 1.4 : 0;
  return { unit, timeToPosition, movementSpeedPerSecond };
};

/**
 * @param {number} baseDistanceToPosition
 * @param {number} buildTimeLeft
 * @param {number} movementSpeedPerSecond
 * @returns {number}
 */
const calculateBaseTimeToPosition = (baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond) => {
  return (baseDistanceToPosition / movementSpeedPerSecond) + getTimeInSeconds(buildTimeLeft) + movementSpeedPerSecond;
};

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleRallyBase = (world, unit, position) => {
  let actions = [];
  actions.push(...worldService.rallyWorkerToTarget(world, position));
  actions.push(...stopUnitFromMovingToPosition(unit, position));
  return actions;
};

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @param {UnitTypeId} unitType
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleNonRallyBase = (world, unit, position, unitCommand, unitType) => {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const { pos } = unit; if (pos === undefined) return [];
  let actions = [];

  const orderTargetPosition = unitResourceService.getOrderTargetPosition(units, unit);
  const movingButNotToPosition = unitService.isMoving(unit) && orderTargetPosition && getDistance(orderTargetPosition, position) > 1;

  // check for units near the building position
  const unitsNearPosition = units.getAlive(Alliance.SELF).filter(u => u.pos && getDistance(u.pos, position) <= 2);

  unitsNearPosition.forEach(u => {
    if (u.pos) { // only consider units where pos is defined
      const moveAwayCommand = createUnitCommand(MOVE, [u]);
      moveAwayCommand.targetWorldSpacePos = getAwayPosition(u.pos, position);
      actions.push(moveAwayCommand);
    }
  });

  actions.push(...worldService.rallyWorkerToTarget(world, position, true));

  // check for a current unit that is heading towards position
  const currentUnitMovingToPosition = units.getWorkers().find(u => {
    const orderTargetPosition = unitResourceService.getOrderTargetPosition(units, u); if (orderTargetPosition === undefined) return false;
    return unitService.isMoving(u) && areApproximatelyEqual(orderTargetPosition, position);
  });

  // if there is a unit already moving to position, check if current unit is closer
  if (currentUnitMovingToPosition) {
    const { pos: currentUnitMovingToPositionPos } = currentUnitMovingToPosition; if (currentUnitMovingToPositionPos === undefined) return [];
    const distanceOfCurrentUnit = getDistanceByPath(resources, pos, position);
    const distanceOfMovingUnit = getDistanceByPath(resources, currentUnitMovingToPositionPos, position);

    if (distanceOfCurrentUnit >= distanceOfMovingUnit) {
      // if current unit is not closer, return early
      return actions;
    }
  }

  if (!unit.isConstructing() && !movingButNotToPosition) {
    unitCommand.targetWorldSpacePos = position;
    setBuilderLabel(unit);
    actions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, unit, position));
    unitService.setPendingOrders(unit, unitCommand);
    if (agent.race === Race.ZERG) {
      const { foodRequired } = data.getUnitTypeData(unitType);
      if (foodRequired !== undefined) {
        planService.pendingFood -= foodRequired;
      }
    }
  }
  actions.push(...worldService.rallyWorkerToTarget(world, position, true));

  return actions;
};

function getBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach(({ x, y }) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  return { minX, minY, maxX, maxY };
}

function boundingBoxesOverlap(box1, box2) {
  return !(box2.minX > box1.maxX ||
    box2.maxX < box1.minX ||
    box2.minY > box1.maxY ||
    box2.maxY < box1.minY);
}

/**
 * @param {Map} map 
 * @param {any} targetValue
 * @returns {Array}
 */
function findKeysForValue(map, targetValue) {
  const keys = [];

  for (const [key, value] of map.entries()) {
    if (value === targetValue) {
      keys.push(key);
    }
  }

  return keys;
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
  worldService.addEarmark(data, data.getUnitTypeData(addOnType));

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
  worldService.addEarmark(data, data.getUnitTypeData(addOnType));
}

/**
 * Function to gather builder candidates
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @param {Point2D} position
 * @returns {Unit[]}
 */
function gatherBuilderCandidates(units, builderCandidates, position) {
  const { isConstructing, isMoving } = unitService;
  /** @type {Unit[]} */
  const movingOrConstructingNonDrones = [];
  builderCandidates.push(...units.getWorkers().filter(worker => {
    const { orders } = worker; if (orders === undefined) return false;
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const gatheringAndNotMining = worker.isGathering() && !unitResourceService.isMining(units, worker);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === UnitType.PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === UnitType.SCV;
    if (isConstructingOrMovingProbe || isConstructingSCV) movingOrConstructingNonDrones.push(worker);
    const available = (
      worker.noQueue ||
      gatheringAndNotMining ||
      orders.findIndex(order => order.targetWorldSpacePos && (getDistance(order.targetWorldSpacePos, position) < 1)) > -1
    );
    return isNotDuplicate && available;
  }));
  return builderCandidates;
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @returns {Unit[]}
 */
function filterMovingOrConstructingNonDrones(units, builderCandidates) {
  const { isConstructing, isMoving } = unitService;
  const { PROBE, SCV } = UnitType;

  return units.getWorkers().filter(worker => {
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === SCV;

    return (isConstructingOrMovingProbe || isConstructingSCV) && isNotDuplicate;
  });
}

/**
 * Filter out builder candidates who are also moving or constructing drones.
 * 
 * @param {Unit[]} builderCandidates - The array of builder candidates.
 * @param {Unit[]} movingOrConstructingNonDrones - The array of drones that are either moving or in construction.
 * @returns {Unit[]} - The filtered array of builder candidates.
 */
function filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones) {
  return builderCandidates.filter(builder => !movingOrConstructingNonDrones.some(movingOrConstructingNonDrone => movingOrConstructingNonDrone.tag === builder.tag));
}

/**
 * Get clusters of builder candidate positions
 * @param {Unit[]} builderCandidates 
 * @returns {{center: Point2D, units: Unit[]}[]}
 */
function getBuilderCandidateClusters(builderCandidates) {
  // Prepare data for dbscanWithUnits
  let pointsWithUnits = builderCandidates.reduce((/** @type {{point: Point2D, unit: Unit}[]} */accumulator, builder) => {
    const { pos } = builder;
    if (pos === undefined) return accumulator;
    accumulator.push({ point: pos, unit: builder });
    return accumulator;
  }, []);

  // Apply DBSCAN to get clusters
  let builderCandidateClusters = dbscanWithUnits(pointsWithUnits, 9);

  return builderCandidateClusters;
}

/**
 * @param {ResourceManager} resources
 * @param {{center: Point2D, units: Unit[]}[]} builderCandidateClusters
 * @param {Point2D} position
 * @returns {Unit | undefined}
 */
function getClosestBuilderCandidate(resources, builderCandidateClusters, position) {
  const { map, units } = resources.get();
  let closestCluster;
  let shortestClusterDistance = Infinity;

  // Find the closest cluster to the position
  for (let cluster of builderCandidateClusters) {
    const distance = getDistance(cluster.center, position);
    if (distance < shortestClusterDistance) {
      shortestClusterDistance = distance;
      closestCluster = cluster;
    }
  }

  // If no clusters, return undefined
  if (!closestCluster) return undefined;

  let closestBuilderCandidate;
  let shortestCandidateDistance = Infinity;

  // Store the original state of each cell
  const originalCellStates = new Map();
  const gasGeysers = unitResourceService.getGasGeysers(units).filter(geyser => geyser.pos && getDistance(geyser.pos, position) < 1);
  const structureAtPositionCells = getStructureCells(position, gasGeysers);
  [...structureAtPositionCells].forEach(cell => {
    originalCellStates.set(cell, map.isPathable(cell));
    map.setPathable(cell, true);
  });

  // Find the closest candidate within that cluster
  for (let builderCandidate of closestCluster.units) {
    const { pos } = builderCandidate;
    if (pos === undefined) continue;

    const distance = getDistanceByPath(resources, pos, position);

    if (distance < shortestCandidateDistance) {
      shortestCandidateDistance = distance;
      closestBuilderCandidate = builderCandidate;
    }
  }

  // Restore each cell to its original state
  [...structureAtPositionCells].forEach(cell => {
    const originalState = originalCellStates.get(cell);
    map.setPathable(cell, originalState);
  });

  // Return the closest candidate, or undefined if none was found
  return closestBuilderCandidate;
}

/**
 * @param {World} world
 * @param {Unit[]} movingOrConstructingNonDrones 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number}[]}
 */
function calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position) {
  const { getClosestUnitPositionByPath, getDistanceByPath } = resourceManagerService;
  const { getMovementSpeed, getPendingOrders } = unitService;
  const { resources } = world;
  const { map, units } = resources.get();
  const { SCV, SUPPLYDEPOT } = UnitType;

  return movingOrConstructingNonDrones.reduce((/** @type {{unit: Unit, timeToPosition: number}[]} */acc, movingOrConstructingNonDrone) => {
    const { orders, pos, unitType } = movingOrConstructingNonDrone;
    if (orders === undefined || pos === undefined || unitType === undefined) return acc;

    orders.push(...getPendingOrders(movingOrConstructingNonDrone));
    const { abilityId, targetWorldSpacePos, targetUnitTag } = orders[0];
    if (abilityId === undefined || (targetWorldSpacePos === undefined && targetUnitTag === undefined)) return acc;

    const movingPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined;
    const movementSpeed = getMovementSpeed(map, movingOrConstructingNonDrone);
    if (movingPosition === undefined || movementSpeed === undefined) return acc;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const isSCV = unitType === SCV;
    const constructingStructure = isSCV ? getStructureAtPosition(units, movingPosition) : undefined;
    constructingStructure && setPathableGrids(map, constructingStructure, true);

    const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
    const movingProbeTimeToMovePosition = getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeedPerSecond;

    constructingStructure && setPathableGrids(map, constructingStructure, false);

    let buildTimeLeft = 0;
    let supplyDepotCells = [];
    if (isSCV) {
      buildTimeLeft = getContructionTimeLeft(world, movingOrConstructingNonDrone);
      const isConstructingSupplyDepot = dataService.unitTypeTrainingAbilities.get(abilityId) === SUPPLYDEPOT;
      if (isConstructingSupplyDepot) {
        const [supplyDepot] = units.getClosest(movingPosition, units.getStructures().filter(structure => structure.unitType === SUPPLYDEPOT));
        if (supplyDepot !== undefined) {
          const { pos, unitType } = supplyDepot; if (pos === undefined || unitType === undefined) return acc;
          const footprint = getFootprint(unitType); if (footprint === undefined) return acc;
          supplyDepotCells = cellsInFootprint(pos, footprint);
          supplyDepotCells.forEach(cell => map.setPathable(cell, true));
        }
      }
    }

    const pathablePremovingPosition = getClosestUnitPositionByPath(resources, position, pathableMovingPosition);
    const targetTimeToPremovePosition = getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeedPerSecond;
    supplyDepotCells.forEach(cell => map.setPathable(cell, false));

    const timeToPosition = movingProbeTimeToMovePosition + buildTimeLeft + targetTimeToPremovePosition;

    acc.push({
      unit: movingOrConstructingNonDrone,
      timeToPosition: timeToPosition
    });

    return acc;
  }, []);
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {{unit: Unit, timeToPosition: number}[]} movingOrConstructingNonDronesTimeToPosition
 * @param {Unit | undefined} closestBuilder
 * @returns {Array<{unit: Unit, timeToPosition: number}>}
 */
const gatherCandidateWorkersTimeToPosition = (resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilder) => {
  const { map } = resources.get();
  const { getClosestPathablePositionsBetweenPositions } = resourceManagerService;
  let candidateWorkersTimeToPosition = [];

  const [movingOrConstructingNonDrone] = movingOrConstructingNonDronesTimeToPosition.sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.timeToPosition - b.timeToPosition;
  });

  if (movingOrConstructingNonDrone !== undefined) {
    candidateWorkersTimeToPosition.push(movingOrConstructingNonDrone);
  }

  if (closestBuilder !== undefined) {
    const { pos } = closestBuilder;
    if (pos === undefined) return candidateWorkersTimeToPosition;

    const movementSpeed = unitService.getMovementSpeed(map, closestBuilder);
    if (movementSpeed === undefined) return candidateWorkersTimeToPosition;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const closestPathablePositionsBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, position);
    const closestBuilderWithDistance = {
      unit: closestBuilder,
      timeToPosition: closestPathablePositionsBetweenPositions.distance / movementSpeedPerSecond
    };

    candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
  }

  return candidateWorkersTimeToPosition;
};

/**
 * Calculate the closest constructing worker and the time to reach a specific position
 * @param {World} world - The resources object to access game state
 * @param {Unit[]} constructingWorkers - The array of workers currently in constructing state
 * @param {Point2D} position - The position to calculate the distance to
 * @returns {{unit: Unit, timeToPosition: number} | undefined} - Closest constructing worker and time to reach the position or undefined
 */
function calculateClosestConstructingWorker(world, constructingWorkers, position) {
  const { getDistanceByPath } = resourceManagerService;
  const { data, resources } = world;
  const { units } = resources.get();

  return constructingWorkers.reduce((/** @type {{unit: Unit, timeToPosition: number} | undefined} */closestWorker, worker) => {
    const { orders, pos } = worker; if (orders === undefined || pos === undefined) return closestWorker;
    // get unit type of building in construction
    const constructingOrder = orders.find(order => order.abilityId && groupTypes.constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return closestWorker;
    const { abilityId } = constructingOrder; if (abilityId === undefined) return closestWorker;
    const unitType = dataService.unitTypeTrainingAbilities.get(abilityId); if (unitType === undefined) return closestWorker;
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return closestWorker;

    // get closest unit type to worker position if within unit type radius
    const closestUnitType = units.getClosest(pos, units.getById(unitType)).filter(unit => unit.pos && distance(unit.pos, pos) < 3)[0];

    if (closestUnitType) {
      const { buildProgress } = closestUnitType; if (buildProgress === undefined) return closestWorker;
      const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
      const distanceToPositionByPath = getDistanceByPath(resources, pos, position);
      const { movementSpeed } = worker.data(); if (movementSpeed === undefined) return closestWorker;
      const movementSpeedPerSecond = movementSpeed * 1.4;
      const timeToPosition = buildTimeLeft + (distanceToPositionByPath / movementSpeedPerSecond);

      // If this is the first worker or if it's closer than the current closest worker, update closestWorker
      if (!closestWorker || timeToPosition < closestWorker.timeToPosition) {
        return { unit: worker, timeToPosition };
      }
    }

    return closestWorker;
  }, undefined);
}
/**
 * Create a command and add it to the collected actions.
 * @param {AbilityId} abilityId - The ability or command ID.
 * @param {Unit} selfUnit - The unit issuing the command.
 * @param {Point2D} targetPosition - The target position for the command.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - A collection of actions to execute.
 * @param {boolean} [queue=false] - Whether to queue this command or not.
 * @returns {SC2APIProtocol.ActionRawUnitCommand}
 */
function createAndAddUnitCommand(abilityId, selfUnit, targetPosition, collectedActions, queue = false) {
  const unitCommand = createUnitCommand(abilityId, [selfUnit]);
  unitCommand.targetWorldSpacePos = targetPosition;

  if (queue) {
    // Assuming your SC2APIProtocol.ActionRawUnitCommand has a queue attribute, if not, adjust accordingly.
    unitCommand.queue = true;
  }

  collectedActions.push(unitCommand);
  return unitCommand;  // Return the created unitCommand
}
/**
 * @param {SC2APIProtocol.Point2D} point1
 * @param {SC2APIProtocol.Point2D} point2
 * @param {number} epsilon
 * @returns {boolean}
 */
const areApproximatelyEqual = (point1, point2, epsilon = 0.0002) => {
  if (point1.x === undefined || point1.y === undefined || point2.x === undefined || point2.y === undefined) {
    return false;
  }

  const dx = Math.abs(point1.x - point2.x);
  const dy = Math.abs(point1.y - point2.y);

  return dx < epsilon && dy < epsilon;
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @returns {boolean}
 */
function isIdleOrAlmostIdle(data, unit) {
  // if the unit is idle, no need to check anything else
  if (unit.orders && unit.orders.length === 0 && unit.buildProgress && unit.buildProgress === 1) {
    return true;
  }

  // now check if it is almost idle
  const { abilityId = null, progress = null } = (unit.orders && unit.orders.length > 0) ? unit.orders[0] : {};
  let unitTypeTraining;
  if (abilityId !== null) {
    unitTypeTraining = dataService.unitTypeTrainingAbilities.get(abilityId);
  }
  const unitTypeData = unitTypeTraining && data.getUnitTypeData(unitTypeTraining);
  const { buildTime } = unitTypeData || {};
  let buildTimeLeft;
  if (buildTime !== undefined && progress !== null) {
    buildTimeLeft = unitService.getBuildTimeLeft(unit, buildTime, progress);
  }
  const isAlmostIdle = buildTimeLeft !== undefined && buildTimeLeft <= 8 && unitService.getPendingOrders(unit).length === 0;
  return isAlmostIdle;
}

/**
 * @param {Point2D} buildingPosition
 * @param {Point2D} unitPosition
 * @returns {Point2D}
 */
function getAwayPosition(buildingPosition, unitPosition) {
  // Default to 0 if undefined
  const unitX = unitPosition.x || 0;
  const unitY = unitPosition.y || 0;
  const buildingX = buildingPosition.x || 0;
  const buildingY = buildingPosition.y || 0;

  const dx = unitX - buildingX;
  const dy = unitY - buildingY;
  return {
    x: unitX + dx,
    y: unitY + dy
  };
}

/**
 * Earmark resources if needed.
 *
 * @param {World} world
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 * @param {number | boolean | null} earmarkNeeded
 * @returns {boolean}
 */
const earmarkResourcesIfNeeded = (world, unitTypeData, earmarkNeeded) => {
  const earmarkNeededBool = Boolean(earmarkNeeded);

  if (earmarkNeededBool) {
    worldService.addEarmark(world.data, unitTypeData);
  }

  return !earmarkNeededBool;
};

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number} The time in seconds until the agent can afford the specified unit type.
 */
function getTimeUntilCanBeAfforded(world, unitType) {
  const timeToTargetCost = getTimeToTargetCost(world, unitType);
  const timeToTargetTech = getTimeToTargetTech(world, unitType);

  // the time until the unit can be afforded is the maximum of the two times
  return Math.max(timeToTargetCost, timeToTargetTech);
}

/**
 * Get units that are capable to add an add-on (either they don't have one or they have one but can add another).
 * @param {Unit[]} units 
 * @returns {Unit[]}
 */
function getUnitsCapableToAddOn(units) {
  return units.filter(unit => unit.unitType && canUnitBuildAddOn(unit.unitType));
}


/**
 * Check if a unit type can construct an addon.
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function canUnitBuildAddOn(unitType) {
  const { BARRACKS, FACTORY, STARPORT } = UnitType;
  // Add the unit types that can construct addons here
  const addonConstructingUnits = [
    ...(countTypes.get(BARRACKS) || []), ...(addOnTypesMapping.get(BARRACKS) || []),
    ...(countTypes.get(FACTORY) || []), ...(addOnTypesMapping.get(FACTORY) || []),
    ...(countTypes.get(STARPORT) || []), ...(addOnTypesMapping.get(STARPORT) || []),
  ];
  return addonConstructingUnits.includes(unitType);
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @returns {number}
 */
function getTimeUntilUnitCanBuildAddon(world, unit) {
  const { data } = world;
  const { buildProgress, isFlying, orders, pos, unitType } = unit;
  if (buildProgress === undefined || isFlying === undefined || orders === undefined || pos === undefined || unitType === undefined) return Infinity;

  // If unit is under construction, calculate the time until it finishes
  if (buildProgress !== undefined && buildProgress < 1) {
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return Infinity;
    const remainingTime = getTimeInSeconds(buildTime - (buildTime * buildProgress));
    return remainingTime;
  }

  // If unit is idle, check if it already has an add-on
  if (unit.isIdle()) {
    // If unit already has an add-on, calculate the time it takes for the structure to lift off, move, and land
    if (hasAddOn(unit)) {
      return calculateLiftLandAndMoveTime(world, unit);
    } else if (isFlying) { // New condition for flying and idle units
      return calculateLiftLandAndMoveTime(world, unit);
    }
    return 0;
  }

  // If unit is flying or its unit type indicates that it's a flying unit
  if (isFlying || flyingTypesMapping.has(unitType)) {
    if (orders && orders.length > 0) {
      const order = orders[0];
      if (order.targetWorldSpacePos) {
        return calculateLiftLandAndMoveTime(world, unit, order.targetWorldSpacePos);
      }
    }

    // If the unit's orders don't provide a target position, return Infinity
    return Infinity;
  }

  // If unit is training or doing something else, calculate the time until it finishes
  if (orders && orders.length > 0) {
    const order = orders[0];
    const { abilityId, progress } = order; if (abilityId === undefined || progress === undefined) return Infinity;
    const unitTypeTraining = dataService.unitTypeTrainingAbilities.get(abilityId); if (unitTypeTraining === undefined) return Infinity;
    const { buildTime } = data.getUnitTypeData(unitTypeTraining); if (buildTime === undefined) return Infinity;

    const remainingTime = getTimeInSeconds(buildTime - (buildTime * progress));
    if (hasAddOn(unit)) {
      return remainingTime + calculateLiftLandAndMoveTime(world, unit);
    }
    return remainingTime;
  }

  // If unit is not idle, not under construction, and not building something, assume it will take a longer time to be available
  return Infinity;
}

/**
 * Calculate the time it takes for a unit with an add-on to lift off (if not already flying), move, and land
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D | undefined} targetPosition
 * @returns {number}
 */
function calculateLiftLandAndMoveTime(world, unit, targetPosition=undefined) {
  const { data } = world;
  const { isFlying, pos, unitType } = unit; if (isFlying === undefined || pos === undefined || unitType === undefined) return Infinity;

  // Get lift and landing time from service
  const { liftAndLandingTime } = unitService; // placeholder value, replace with actual value

  // Get movement speed data for a flying barracks
  const { movementSpeed } = data.getUnitTypeData(BARRACKSFLYING); if (movementSpeed === undefined) return Infinity;
  const movementSpeedPerSecond = movementSpeed * 1.4;

  targetPosition = targetPosition || findBestPositionForAddOn(world, unit); // placeholder function, replace with your own logic
  if (!targetPosition) return Infinity;
  const distance = getDistance(pos, targetPosition); // placeholder function, replace with your own logic
  const timeToMove = distance / movementSpeedPerSecond;

  // If unit is already flying, don't account for the lift-off time
  const totalLiftAndLandingTime = (isFlying || flyingTypesMapping.has(unitType)) ? liftAndLandingTime : liftAndLandingTime * 2;

  return totalLiftAndLandingTime + timeToMove;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D | undefined} targetPosition
 * @returns {Promise<SC2APIProtocol.ResponseAction | undefined>}
 */
async function prepareUnitToBuildAddon(world, unit, targetPosition) {
  const { getPendingOrders } = unitService;
  const { agent, data, resources } = world;
  const { foodUsed } = agent; if (foodUsed === undefined) return;
  const { actions } = resources.get();

  const currentFood = foodUsed;
  const unitBeingTrained = getUnitBeingTrained(unit); // Placeholder function, replace with your own logic
  const foodUsedByTrainingUnit = unitBeingTrained ? getFoodUsedByUnitType(data, unitBeingTrained) : 0;
  const plan = getPlanFoodValue(); // Function to get the plan's food value

  // If the structure is idle (and has no pending orders) and flying, it should land at the target position
  if (unit.isIdle() && getPendingOrders(unit).length === 0 && isStructureLifted(unit) && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    landCommand.targetWorldSpacePos = targetPosition;
    return actions.sendAction([landCommand]);
  }

  // If the structure can be lifted and has no pending orders, issue a lift command
  if (canStructureLiftOff(unit) && getPendingOrders(unit).length === 0) {
    const liftCommand = createUnitCommand(Ability.LIFT, [unit]);
    return actions.sendAction([liftCommand]);
  }

  // If the structure is in a lifted state and has no pending orders, issue a land command
  if (isStructureLifted(unit) && getPendingOrders(unit).length === 0 && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    landCommand.targetWorldSpacePos = targetPosition;
    return actions.sendAction([landCommand]);
  }

  // If the unit is busy with another order, cancel it only if it doesn't break the plan and has no pending orders
  if (!unit.isIdle() && getPendingOrders(unit).length === 0 && (currentFood - foodUsedByTrainingUnit >= plan)) {
    const cancelCommand = createUnitCommand(CANCEL_QUEUE5, [unit]);
    return actions.sendAction([cancelCommand]);
  }
}


/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} logCondition
 * @returns {Point2D | undefined}
 */
function findBestPositionForAddOn(world, unit, logCondition = false) {
  const { checkAddOnPlacement } = worldService;
  const { resources } = world;
  const { map } = resources.get();
  const { isFlying, pos } = unit; if (isFlying === undefined || pos === undefined) return undefined;

  // use logCondition to log the reason why the function returned undefined
  if (logCondition) {
    console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} ${unit.isFlying ? 'is flying' : 'is grounded'} and ${unit.isIdle() ? 'is idle' : 'is busy'} and ${hasAddOn(unit) ? 'has an add-on' : 'does not have an add-on'}`);
  }

  // Scenario 0: The building is idle, doesn't have an add-on, and is flying.
  if (unit.isIdle() && !hasAddOn(unit) && isFlying) {
    const landingSpot = checkAddOnPlacement(world, unit);
    if (landingSpot !== undefined) {
      // If a suitable landing spot is available, return it
      return landingSpot;
    } else {
      // If no suitable landing spot is available, we can't handle this scenario
      return undefined;
    }
  }

  // Scenario 1: The building is idle, doesn't have an add-on, and is grounded.
  if (unit.isIdle() && !hasAddOn(unit) && !isFlying) {
    const addonPosition = getAddOnPlacement(pos); // get the position where the add-on would be built
    if (map.isPlaceableAt(UnitType.REACTOR, addonPosition)) { // check if the add-on can be placed there
      return undefined; // The building is idle and can build an add-on, return null and check it again later.
    }
  }

  // Scenario 2: The building is busy but will become idle after current action.
  if (!unit.isIdle() && !hasAddOn(unit)) {
    // Here, it depends on the urgency of the add-on and your strategy
    // You might wait for the unit to be idle or cancel the current action
    // Then, it becomes Scenario 1 again.
    // For simplicity, we assume we wait until it's idle and can use the same logic to find position
    return undefined; // The building is currently busy, return null and check it again later.
  }

  // Scenario 3: The building is under construction.
  if (unit.buildProgress !== undefined && unit.buildProgress < 1) {
    // The building is still being constructed, so it cannot build an add-on yet.
    // Similar to Scenario 2, we will check it again later.
    return undefined;
  }

  // Scenario 4: The building already has an add-on.
  if (hasAddOn(unit)) {
    // Find a suitable landing spot
    const landingSpot = checkAddOnPlacement(world, unit);
    if (logCondition) {
      console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} has an add-on and ${landingSpot ? 'has a suitable landing spot' : 'does not have a suitable landing spot'}`);
    }
    if (landingSpot !== undefined) {
      // If a suitable landing spot is available, return it
      return landingSpot;
    } else {
      // If no suitable landing spot is available, we can't handle this scenario
      return undefined;
    }
  }

  // Scenario 5: The building can lift off and there is a nearby location with enough space.
  if (canLiftOff(unit)) {
    // You will have to define the function findNearbyLocationWithSpace()
    // which finds a nearby location with enough space for the building and an add-on.
    const newLocation = checkAddOnPlacement(world, unit);
    if (newLocation) {
      // In this case, you will want to move your unit to the new location before building the add-on.
      // You might want to store this information (that the unit needs to move before building the add-on) somewhere.
      return newLocation;
    }
  }

  // If no suitable position was found, return null
  return undefined;
}

/**
 * @param {Unit} unit
 * @returns {boolean}
 */
function hasAddOn(unit) {
  return String(unit.addOnTag) !== '0';
}

/**
 * @param {Unit} unit 
 * @returns {boolean}
 */
function canLiftOff(unit) {
  const { unitType } = unit; if (unitType === undefined) return false;
  // The unit types that can lift off
  const typesThatCanLiftOff = new Set([UnitType.COMMANDCENTER, UnitType.BARRACKS, UnitType.FACTORY, UnitType.STARPORT]);

  return typesThatCanLiftOff.has(unitType);
}

/**
 * @param {DataStorage} data
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
function getFoodUsedByUnitType(data, unitType) {
  const { foodRequired } = data.getUnitTypeData(unitType);
  return foodRequired || 0;
}

function getPlanFoodValue() {
  return planService.plan[planService.currentStep].food;
}

/**
 * @param {Unit} unit 
 * @returns {UnitTypeId | null}
 */
function getUnitBeingTrained(unit) {
  // Access the unit's orders, assuming they exist and are structured as an array
  const { orders } = unit;
  if (!orders || orders.length === 0) return null;

  // The training order should be the first order in the list
  const trainingOrder = orders[0];
  const { abilityId } = trainingOrder; if (abilityId === undefined) return null;

  // The target type of the training order should be the unit type being trained
  const unitBeingTrained = dataService.unitTypeTrainingAbilities.get(abilityId); if (unitBeingTrained === undefined) return null;

  return unitBeingTrained || null;
}

/**
 * Checks if a structure can lift off.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit can lift off.
 */
function canStructureLiftOff(unit) {
  return unit.availableAbilities().some(ability => groupTypes.liftingAbilities.includes(ability));
}

/**
 * Checks if a structure is lifted.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit is lifted.
 */
function isStructureLifted(unit) {
  return unit.availableAbilities().some(ability => groupTypes.landingAbilities.includes(ability));
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @returns {number}
 */
function getSelfDPSHealth(world, unit) {
  const { resources } = world;
  const { units } = resources.get();
  const { getSelfUnits } = unitResourceService;
  const { selfDPSHealth } = unitService;
  const { pos, alliance, tag } = unit; 

  if (pos === undefined || alliance === undefined || tag === undefined) return 0;
  if (selfDPSHealth.has(tag)) return selfDPSHealth.get(tag) || 0;

  const targetUnits = alliance === Alliance.ENEMY ? enemyTrackingService.mappedEnemyUnits : trackUnitsService.selfUnits;
  const [closestEnemyUnit] = units.getClosest(pos, targetUnits).filter(enemyUnit => enemyUnit.pos && getDistance(enemyUnit.pos, pos) <= 16);

  const enemyUnitSelfUnitTypes = closestEnemyUnit ? getSelfUnits(units, closestEnemyUnit).reduce((/** @type {UnitTypeId[]} */acc, enemyUnitSelfUnit) => {
    const { unitType } = enemyUnitSelfUnit;
    if (unitType !== undefined) acc.push(unitType);
    return acc;
  }, []) : [];

  const dpsHealth = worldService.calculateNearDPSHealth(world, getSelfUnits(units, unit), enemyUnitSelfUnitTypes);
  unitService.selfDPSHealth.set(tag, dpsHealth);
  return dpsHealth;
}

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {Point2D}
 */
function subtractVectors(a, b) {
  return {
    x: (a.x || 0) - (b.x || 0),
    y: (a.y || 0) - (b.y || 0)
  };
}

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {number}
 */
function dotVectors(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0);
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {number[][]} pathToRally
 * @returns {boolean}
 */
function isSafePathToRally(world, unit, pathToRally) {
  const { pos: unitPos } = unit;
  if (!unitPos) return false;

  const { data, resources } = world;
  const { units } = resources.get();

  const aliveEnemies = units.getAlive(Alliance.ENEMY).filter(e => e.pos);
  if (!aliveEnemies.length) return true;

  return !getPathCoordinates(pathToRally).some(point => {
    const closestEnemies = units.getClosest(point, aliveEnemies);
    if (!closestEnemies.length) return false;

    const closestEnemy = closestEnemies[0];
    const { radius: enemyRadius, tag: enemyTag, unitType: enemyType, pos: enemyPos } = closestEnemy;

    if (!enemyPos || typeof enemyType !== 'number') return false;

    const targetPositions = enemyTag ? enemyTrackingService.enemyUnitsPositions.get(enemyTag) : null;
    const projectedTargetPosition = targetPositions ?
      getProjectedPosition(
        targetPositions.current.pos,
        targetPositions.previous.pos,
        targetPositions.current.lastSeen,
        targetPositions.previous.lastSeen
      ) : enemyPos;

    if (!projectedTargetPosition) return false;

    const weapon = unitService.getWeaponThatCanAttack(data, enemyType, unit);
    const attackRange = weapon?.range;
    if (!attackRange) return false;

    const effectiveAttackRange = attackRange + (unit.radius || 0) + (enemyRadius || 0);
    const distanceSquared = getDistanceSquared(point, projectedTargetPosition);

    if (distanceSquared <= effectiveAttackRange * effectiveAttackRange) {
      const directionToEnemy = subtractVectors(projectedTargetPosition, unitPos);
      const directionOfMovement = subtractVectors(point, unitPos);
      return dotVectors(directionToEnemy, directionOfMovement) < 0;
    }

    return false;
  });
}
/**
 * @param {ResourceManager} resources
 * @param {SC2APIProtocol.Point} pos
 * @param {SC2APIProtocol.Point[]} mapPoints
 */
function getClosestPositionByPathSorted(resources, pos, mapPoints) {
  const { map } = resources.get();
  return mapPoints.map(point => {
    const [closestPathablePosition] = resourceManagerService.getClosestPositionByPath(resources, pos, getPathablePositions(map, point));
    return {
      point,
      distanceByPath: getDistanceByPath(resources, pos, closestPathablePosition)
    };
  }).sort((a, b) => a.distanceByPath - b.distanceByPath);
}
/**
 * @param {MapResource} map
 * @param {Point2D} unitPos
 * @param {Point2D} point
 * @returns {Expansion[]}
 */
function getExpansionsInPath(map, unitPos, point) {
  const pathCoordinates = getPathCoordinates(MapResourceService.getMapPath(map, unitPos, point));
  const pathCoordinatesBoundingBox = getBoundingBox(pathCoordinates);

  const expansionsInPath = map.getExpansions().filter(expansion => {
    const areaFill = expansion?.areas?.areaFill;
    const centroid = expansion?.centroid;

    if (!areaFill || !centroid) return false;  // If either is undefined, filter out

    // Filter out the expansion where the point is where the centroid is.
    if (getDistance(point, centroid) < 1) return false;

    // Filter out expansions where the centroid is within a distance of 16 from unitPos.
    if (getDistance(unitPos, centroid) <= 16) return false;

    const areaFillBoundingBox = getBoundingBox(areaFill);

    return boundingBoxesOverlap(pathCoordinatesBoundingBox, areaFillBoundingBox)
      && pointsOverlap(pathCoordinates, areaFill);
  });

  return expansionsInPath;
}
/**
 * Checks whether the retreat path and point are safe based on the allies and enemies near the path and point.
 *
 * @param {World} world - The collection of all units in the game.
 * @param {Unit} unit - The unit we are considering the retreat for.
 * @param {Point2D[]} pathToRetreat - The series of points defining the path to the retreat point.
 * @param {Point2D} retreatPoint - The final retreat point.
 * @returns {boolean} - Returns true if the path and point are safe to retreat to.
 */
function isSafeToRetreat(world, unit, pathToRetreat, retreatPoint) {
  // First, check the safety of the path
  for (let point of pathToRetreat) {
    if (!isPointSafe(world, unit, point)) {
      return false;  // Unsafe path segment found
    }
  }

  // Then, check the safety of the retreat point itself
  return isPointSafe(world, unit, retreatPoint);
}

/**
 * Helper function that checks the safety of a specific point.
 *
 * @param {World} world - The collection of all units in the game.
 * @param {Unit} unit - The unit we are considering the safety for.
 * @param {Point2D} point - The point to check.
 * @returns {boolean} - Returns true if the point is safe.
 */
function isPointSafe(world, unit, point) {
  if (!unit.pos) {
    return false;
  }

  const { data } = world;
  const directionOfMovement = subtractVectors(point, unit.pos);
  const unitRadius = unit.radius || 0;

  for (const enemy of enemyTrackingService.mappedEnemyUnits) {
    const { radius = 0, tag: enemyTag, unitType, pos: enemyPos } = enemy; // Default to 0 if radius is undefined

    if (!enemyPos || typeof unitType !== 'number') continue;

    const targetPositions = enemyTag && enemyTrackingService.enemyUnitsPositions.get(enemyTag);
    const projectedTargetPosition = targetPositions ? getProjectedPosition(
      targetPositions.current.pos,
      targetPositions.previous.pos,
      targetPositions.current.lastSeen,
      targetPositions.previous.lastSeen
    ) : enemyPos;

    if (!projectedTargetPosition) continue;

    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit);
    if (!weapon?.range) continue;

    const effectiveAttackRange = weapon.range + unitRadius + radius;
    const distanceSquared = getDistanceSquared(point, projectedTargetPosition);
    const directionToEnemy = subtractVectors(projectedTargetPosition, unit.pos);

    if (dotVectors(directionToEnemy, directionOfMovement) > 0 && distanceSquared <= effectiveAttackRange * effectiveAttackRange) {
      return false;
    }
  }

  const alliesAtPoint = getUnitsInRangeOfPosition(trackUnitsService.selfUnits, point, 16).filter(ally => !ally.isWorker());
  const enemiesNearUnit = getUnitsInRangeOfPosition(enemyTrackingService.mappedEnemyUnits, point, 16);

  const { timeToKill, timeToBeKilled } = calculateTimeToKill(world, alliesAtPoint, enemiesNearUnit);

  return timeToKill < timeToBeKilled;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @param {boolean} toCombatRally
 * @param {number} travelDistancePerStep
 * @returns {boolean}
 */
const shouldRetreatToCombatRally = (world, unit, targetUnit, toCombatRally, travelDistancePerStep) => {
  if (!toCombatRally || !unit.pos || !targetUnit.pos || !targetUnit.unitType) return false;

  const { resources } = world;
  const { map, units } = resources.get();
  const combatRally = resourceManagerService.getCombatRally(resources);

  // Check if we're stronger at the combatRally position
  if (!worldService.isStrongerAtPosition(world, combatRally)) return false;

  const unitToCombatRallyDistance = getDistanceByPath(resources, unit.pos, combatRally);
  if (unitToCombatRallyDistance <= travelDistancePerStep || unitToCombatRallyDistance === Infinity) return false;

  const targetUnitToCombatRallyDistance = getDistanceByPath(resources, targetUnit.pos, combatRally);
  if (unitToCombatRallyDistance > targetUnitToCombatRallyDistance) return false;

  const bunkerPositions = units.getById(UnitType.BUNKER).reduce((/** @type {Point2D[]} */acc, unit) => {
    if (unit.buildProgress === 1 && unit.pos) {
      acc.push(unit.pos);
    }
    return acc;
  }, []);

  const [closestBunkerPositionByPath] = getClosestPositionByPathSorted(resources, unit.pos, bunkerPositions);

  const distanceFromCombatRallyToUnit = getDistanceByPath(resources, combatRally, unit.pos);
  const distanceFromBunkerToUnit = closestBunkerPositionByPath ? getDistanceByPath(resources, closestBunkerPositionByPath.point, unit.pos) : Infinity;
  if (distanceFromCombatRallyToUnit >= distanceFromBunkerToUnit) return false;

  const pathToRally = MapResourceService.getMapPath(map, unit.pos, combatRally);
  return isSafePathToRally(world, unit, pathToRally);
}
/**
 * @param {ResourceManager} resources
 * @param {Point2D} pos
 * @param {number} thresholdDistance
 * @returns {boolean}
 */
const shouldRetreatToBunker = (resources, pos, thresholdDistance = 16) => {
  const { units } = resources.get();
  const bunkerPositions = getBunkerPositions(units);
  if (bunkerPositions.length === 0) return false;

  const [closestBunker] = resourceManagerService.getClosestPositionByPath(resources, pos, bunkerPositions);
  if (!closestBunker) return false;
  const distanceToClosestBunker = getDistanceByPath(resources, pos, closestBunker);

  // Only retreat to bunker if it's within a certain threshold distance.
  return distanceToClosestBunker < thresholdDistance;
}

/**
 * @param {UnitResource} units
 * @returns {Point2D[]}
 */
const getBunkerPositions = (units) => {
  return units.getById(UnitType.BUNKER)
    .filter(unit => unit.buildProgress === 1 && unit.pos)
    .reduce((/** @type {Point2D[]} */acc, unit) => {
      const { pos } = unit;
      if (pos) acc.push(pos);
      return acc;
    }, []);
}

/**
 * Gets the closest bunker position from the provided position.
 * @param {ResourceManager} resources - The resources object.
 * @param {Point2D} pos - The position from which the distance needs to be calculated.
 * @returns {Point2D | null} - The position of the closest bunker or null if no bunker is found.
 */
const getClosestBunkerPosition = (resources, pos) => {
  const { units } = resources.get();
  const bunkerUnits = units.getById(UnitType.BUNKER).filter(unit => unit.buildProgress === 1 && unit.pos);

  if (bunkerUnits.length === 0) {
    return null;
  }

  const bunkerPositions = bunkerUnits.map(unit => unit.pos);
  const distances = bunkerPositions.map(bunkerPos => {
    if (bunkerPos) {
      return getDistanceByPath(resources, pos, bunkerPos);
    }
    return Infinity;  // or some other default value indicating an undefined position
  });

  const minDistanceIndex = distances.indexOf(Math.min(...distances));

  const bunkerPosition = bunkerUnits[minDistanceIndex].pos;
  return bunkerPosition ? bunkerPosition : null;

}
/**
 * Determines the best pathable retreat point for the unit.
 * 
 * @param {World} world - The game world.
 * @param {Unit} unit - The unit to retreat.
 * @param {Unit} targetUnit - The unit to retreat from.
 * @param {number} travelDistancePerStep - Distance traveled per step.
 * @returns {Point2D | undefined} - The best pathable retreat point, or undefined.
 */
const determineBestRetreatPoint = (world, unit, targetUnit, travelDistancePerStep) => {
  const { resources } = world;
  const { map } = resources.get();
  const { pos } = unit;
  const { pos: targetPos } = targetUnit;

  // Return early if positions are undefined.
  if (!pos || !targetPos) return undefined;

  let retreatPoint = getBestRetreatCandidatePoint(world, unit, targetUnit);
  if (retreatPoint) return retreatPoint;

  retreatPoint = getPathRetreatPoint(world.resources, unit, getRetreatCandidates(world, unit, targetUnit));
  if (retreatPoint) return retreatPoint;

  retreatPoint = worldService.findClosestSafePosition(world, unit, targetUnit, travelDistancePerStep);
  if (retreatPoint) return retreatPoint;

  return moveAwayPosition(map, targetPos, pos, travelDistancePerStep);
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {Point2D | undefined}
 */
const getBestRetreatCandidatePoint = (world, unit, targetUnit) => {
  const retreatCandidates = getRetreatCandidates(world, unit, targetUnit);
  if (!retreatCandidates || retreatCandidates.length === 0) return;

  const bestRetreatCandidate = retreatCandidates.find(candidate => candidate.safeToRetreat);
  return bestRetreatCandidate ? bestRetreatCandidate.point : undefined;
}

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {import('../interfaces/retreat-candidate').RetreatCandidate[]} retreatCandidates
 * @returns {Point2D | undefined}
 */
const getPathRetreatPoint = (resources, unit, retreatCandidates) => {
  const { pos } = unit; if (pos === undefined) return;
  const retreatPoints = gatherRetreatPoints(retreatCandidates);
  if (!retreatPoints || retreatPoints.length === 0) return;

  const retreatMap = new Map(retreatPoints.map(retreat => [retreat.point, retreat]));
  const pointsArray = retreatPoints.map(retreat => retreat.point);
  const [largestPathDifferencePoint] = getClosestPositionByPathSorted(resources, pos, pointsArray);

  if (largestPathDifferencePoint) {
    const largestPathDifferenceRetreat = retreatMap.get(largestPathDifferencePoint.point);
    if (largestPathDifferenceRetreat) {
      logExpansionInPath(resources, unit, largestPathDifferenceRetreat);
      return largestPathDifferenceRetreat.point;
    }
  }
}

/**
 * @param {import('../interfaces/retreat-candidate').RetreatCandidate[]} retreatCandidates
 * @returns {{ point: Point2D; expansionsInPath: Point2D[]; }[]}
 */
const gatherRetreatPoints = (retreatCandidates) => {
  return retreatCandidates.reduce((/** @type {{ point: Point2D; expansionsInPath: Point2D[]; }[]}} */acc, retreat) => {
    if (retreat?.point) {
      acc.push({
        point: retreat.point,
        expansionsInPath: retreat.expansionsInPath
      });
    }
    return acc;
  }, []);
}

const logExpansionInPath = (resources, unit, retreat) => {
  const timeInSeconds = getTimeInSeconds(resources.get().frame.getGameLoop());
  if (unit.isWorker() && timeInSeconds > 100 && timeInSeconds < 121) {
    console.log('expansionsInPath', retreat.expansionsInPath);
  }
}


/**
 * Utility function to check if a position is truly safe based on all known threats
 * @param {World} world
 * @param {Point2D} position
 * @param {number} safetyRadius - Defines how close a threat can be to consider a position unsafe
 * @returns {boolean}
 */
const isTrulySafe = (world, position, safetyRadius) => {
  const { units } = world.resources.get();

  for (let potentialThreat of units.getAlive(Alliance.ENEMY)) {
    const { pos } = potentialThreat; if (pos === undefined) continue;
    if (getDistance(position, pos) <= safetyRadius) {
      return false;
    }
  }
  return true;
}

/**
 * Derives a safety radius based on the unit's characteristics and potential threats
 * @param {World} world
 * @param {Unit} unit
 * @param {Array<Unit>} potentialThreats
 * @returns {number}
 */
const deriveSafetyRadius = (world, unit, potentialThreats) => {
  const { data, resources } = world;
  const { map } = resources.get();
  let baseSafetyRadius = 0
  let maxThreatRange = 0;

  for (let threat of potentialThreats) {
    const { radius, unitType } = threat; if (radius === undefined || unitType === undefined) continue;
    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit); if (weapon === undefined) continue;
    const threatRange = weapon.range || 0;
    if (threatRange > maxThreatRange) {
      maxThreatRange = threatRange + radius + getTravelDistancePerStep(map, threat);
    }
  }

  const { radius } = unit; if (radius === undefined) return baseSafetyRadius;
  baseSafetyRadius += maxThreatRange + radius + getTravelDistancePerStep(map, unit);
  return baseSafetyRadius;
}
/**
 * Handle logic for melee units in combat scenarios.
 *
 * @param {World} world - The world context.
 * @param {Unit} selfUnit - The melee unit.
 * @param {Unit} targetUnit - The target unit.
 * @param {Point2D} attackablePosition - The position where the unit can attack.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - A collection of actions to execute.
 */
function handleMeleeUnitLogic(world, selfUnit, targetUnit, attackablePosition, collectedActions) {
  const FALLBACK_MULTIPLIER = -1;
  const { data, resources: { get } } = world;
  const { map, units } = get();

  const unitPosition = selfUnit.pos;
  const targetPosition = targetUnit.pos;

  if (!unitPosition || !selfUnit.radius || !targetPosition) return;

  const attackRadius = targetUnit.radius + selfUnit.radius;
  const isValidUnit = createIsValidUnitFilter(data, targetUnit);
  const rangedUnitAlly = units.getClosest(unitPosition, selfUnit['selfUnits'].filter(isValidUnit))[0];

  if (!rangedUnitAlly) {
    moveToSurroundOrAttack();
    return;
  }

  const nearbyAllies = unitService.getUnitsInRadius(units.getAlive(Alliance.SELF), unitPosition, 16);
  const nearbyEnemies = unitService.getUnitsInRadius(enemyTrackingService.mappedEnemyUnits, targetPosition, 16);
  const meleeNearbyAllies = nearbyAllies.filter(unit => !isValidUnit(unit));

  let queueCommand = false;

  if (worldService.shouldEngage(world, meleeNearbyAllies, nearbyEnemies)) {
    moveToSurroundPosition();
  } else if (rangedUnitAlly.pos && shouldFallback(world, selfUnit, rangedUnitAlly, targetUnit)) {
    moveToFallbackPosition();
  }

  attackIfApplicable();

  /**
   * @returns {boolean} Indicates if the melee unit can attack the target unit.
   */
  function isAttackAvailable() {
    const distance = getDistance(unitPosition, targetPosition);
    const weapon = unitService.getWeaponThatCanAttack(data, selfUnit.unitType, targetUnit);
    return selfUnit.weaponCooldown <= 8 && distance <= (weapon?.range || 0) + attackRadius;
  }

  /** Handles the unit's movement or attack logic. */
  function moveToSurroundOrAttack() {
    const surroundPosition = getOptimalSurroundPosition();
    const command = isAttackAvailable() || !surroundPosition
      ? ATTACK_ATTACK
      : MOVE;

    createAndAddUnitCommand(command, selfUnit, surroundPosition || attackablePosition, collectedActions, queueCommand);
    queueCommand = !isAttackAvailable() && !!surroundPosition;
  }

  /** Directs the unit to move to an optimal surround position if available. */
  function moveToSurroundPosition() {
    const surroundPosition = getOptimalSurroundPosition();
    if (!surroundPosition) return;

    createAndAddUnitCommand(MOVE, selfUnit, surroundPosition, collectedActions);
    queueCommand = true;
  }

  /** Directs the unit to move to a fallback position if necessary. */
  function moveToFallbackPosition() {
    const fallbackDirection = getDirection(rangedUnitAlly.pos, targetPosition);
    const fallbackDistance = (rangedUnitAlly.radius + selfUnit.radius) * FALLBACK_MULTIPLIER;
    const position = moveInDirection(rangedUnitAlly.pos, fallbackDirection, fallbackDistance);

    createAndAddUnitCommand(MOVE, selfUnit, position, collectedActions);
    queueCommand = true;
  }

  /** Directs the unit to attack if applicable. */
  function attackIfApplicable() {
    if (!attackablePosition || selfUnit.weaponCooldown > 8) return;

    const attackCommand = createAndAddUnitCommand(ATTACK_ATTACK, selfUnit, attackablePosition, collectedActions, queueCommand);
    collectedActions.push(attackCommand);
  }

  /**
   * @returns {Point2D|null} Retrieves the optimal pathable surround position to attack the target or null if none.
   */
  function getOptimalSurroundPosition() {
    const pathablePositions = getBorderPositions(targetPosition, attackRadius).filter(pos => map.isPathable(pos));

    if (pathablePositions.length === 0) return null;

    return pathablePositions.sort((a, b) => getDistance(b, unitPosition) - getDistance(a, unitPosition))[0];
  }
}
/**
 * @param {DataStorage} data
 * @param {Unit} targetUnit
 * @returns {(unit: Unit) => boolean | undefined}
 */
function createIsValidUnitFilter(data, targetUnit) {
  return (/** @type {Unit} */ unit) => {
    const hasValidWeapon = unit.data().weapons?.some(w => w.range !== undefined && w.range > 1);
    return unit.unitType !== undefined && hasValidWeapon && unitService.getWeaponThatCanAttack(data, unit.unitType, targetUnit) !== undefined;
  };
}

/**
 * @param {World} world
 * @param {Unit} selfUnit
 * @param {Unit} rangedUnitAlly
 * @param {Unit} targetUnit
 * @returns {string} 'fallback' or 'engage'
 */
function checkPositionValidityForAttack(world, selfUnit, rangedUnitAlly, targetUnit) {
    const { data, resources } = world;
    const { map } = resources.get();
    const { pos } = selfUnit; 
    if (pos === undefined) return 'engage';

    const { pos: rangedUnitAllyPos, radius: rangedUnitAllyRadius, unitType: rangedUnitAllyUnitType } = rangedUnitAlly;
    if (rangedUnitAllyPos === undefined || rangedUnitAllyRadius === undefined || rangedUnitAllyUnitType === undefined) return 'engage';

    const { pos: targetUnitPos, radius: targetUnitRadius, unitType: targetUnitType } = targetUnit;
    if (targetUnitPos === undefined || targetUnitRadius === undefined || targetUnitType === undefined) return 'engage';

    const distanceBetweenUnits = getDistance(pos, rangedUnitAllyPos);
    const rangedAllyEdgeDistance = getDistance(rangedUnitAllyPos, targetUnitPos) - rangedUnitAllyRadius - targetUnitRadius;
    const rangedAllyWeapon = unitService.getWeaponThatCanAttack(data, rangedUnitAllyUnitType, targetUnit);

    if (!rangedAllyWeapon) return 'engage'; // Exit if the ranged ally has no weapon that can attack the target

    const enemyWeapon = unitService.getWeaponThatCanAttack(data, targetUnitType, rangedUnitAlly);
    const enemyRange = enemyWeapon ? enemyWeapon.range ?? 0 : 0; // If the enemy has no weapon, assume 0 range

    const enemyTravelDistancePerStep = getTravelDistancePerStep(map, targetUnit);
    const meleeTravelDistancePerStep = getTravelDistancePerStep(map, selfUnit);
    const minDistanceForMove = Math.max(0, enemyRange + enemyTravelDistancePerStep + meleeTravelDistancePerStep);

    const allyTravelDistancePerStep = getTravelDistancePerStep(map, rangedUnitAlly);
    const rangedAllyWeaponRange = rangedAllyWeapon.range || 0;

    if (rangedAllyEdgeDistance > rangedAllyWeaponRange + allyTravelDistancePerStep &&
        distanceBetweenUnits > minDistanceForMove) {
        return 'fallback';
    }

    return 'engage';
}

/**
 * Calculates the directional vector from one position to another.
 * @param {Point2D} startPos - The starting position with x and y properties.
 * @param {Point2D} targetPos - The target position with x and y properties.
 * @returns {Point2D} - The directional vector with x and y properties.
 */
function getDirection(startPos, targetPos) {
  let dx = (targetPos.x ?? 0) - (startPos.x ?? 0);
  let dy = (targetPos.y ?? 0) - (startPos.y ?? 0);

  // Calculate the length of the vector to normalize it to a unit vector.
  let length = Math.sqrt(dx * dx + dy * dy);

  // Normalize the vector to a length of 1 (if length is not 0).
  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  return {
    x: dx,
    y: dy
  };
}

/**
 * Move in a specified direction from a starting point by a certain distance.
 *
 * @param {Object} startPos - Starting position with x and y properties.
 * @param {Object} direction - Direction with normalized x and y properties.
 * @param {number} distance - The distance to move in the given direction.
 * @returns {Object} - New position after moving.
 */
function moveInDirection(startPos, direction, distance) {
  if (startPos.x === undefined || startPos.y === undefined || direction.x === undefined || direction.y === undefined) {
    // Handle the error as needed, e.g., throw an error or return a default value
    throw new Error("Position or direction properties are undefined.");
  }

  return {
    x: startPos.x + direction.x * distance,
    y: startPos.y + direction.y * distance
  };
}

/**
 * @param {Unit} unit
 * @returns {boolean}
 */
function shouldReturnEarly(unit) {
  const properties = ['alliance', 'pos', 'radius', 'tag', 'unitType'];
  return properties.some(prop => unit[prop] === undefined);
}
/**
 * @param {World} world 
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function getActionsForMicro(world, unit, targetUnit) {
  const { resources } = world;
  const { map } = resources.get();

  // Identify other potential threats close to the main targetUnit
  const nearbyThreats = findNearbyThreats(world, unit, targetUnit);
  const allThreats = [targetUnit, ...nearbyThreats];

  // Now handle like before
  const threatPositions = allThreats.flatMap(target => findPositionsInRangeOfEnemyUnits(world, unit, [target]));

  // Calculate the optimal distance from threats
  const optimalDistance = getOptimalAttackDistance(world, unit, allThreats);

  // Filter out positions that are too close to the threats
  const safePositions = threatPositions.filter(position =>
    allThreats.every(threat =>
      getDistance(position, threat.pos) >= optimalDistance
    )
  );

  const projectedTargetPositions = allThreats.map(targetUnit => {
    const targetTag = targetUnit.tag;
    const targetPositions = enemyTrackingService.enemyUnitsPositions.get(targetTag);
    return targetPositions ?
      getProjectedPosition(
        targetPositions.current.pos,
        targetPositions.previous.pos,
        targetPositions.current.lastSeen,
        targetPositions.previous.lastSeen
      ) : targetUnit.pos;
  });

  const combinedThreatPosition = avgPoints(projectedTargetPositions);
  const addPosition = add(unit.pos, subtract(combinedThreatPosition, unit.pos));

  // If there are safe positions, find the closest one
  let closestSafePosition;
  if (safePositions.length > 0) {
    [closestSafePosition] = safePositions.sort((a, b) =>
      getDistanceByPath(resources, addPosition, a) - getDistanceByPath(resources, addPosition, b)
    );
  } else {
    // Fallback logic if no safe positions are found
    closestSafePosition = moveAwayPosition(map, combinedThreatPosition, unit.pos);
  }

  const unitCommand = createUnitCommand(MOVE, [unit]);
  unitCommand.targetWorldSpacePos = closestSafePosition;

  return [unitCommand];
}
/**
 * Computes and returns the actions for a given unit when not micro-managing.
 *
 * @param {World} world - The game state or environment.
 * @param {Unit} unit - The unit we're calculating actions for.
 * @param {Unit} targetUnit - A specific target unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of commands or actions for the unit.
 */
function getActionsForNotMicro(world, unit, targetUnit) {
  const MAX_DISTANCE = 16; // Maximum distance to consider for engagement

  const { data, resources } = world;
  const currentStep = resources.get().frame.getGameLoop();

  if (!isUnitDataComplete(unit) || !unit.pos) return [];

  const weaponResults = computeWeaponsResults(unit, targetUnit);
  if (!weaponResults) return [];

  let immediateThreat = findImmediateThreat(data, unit, weaponResults.targetableEnemyUnits);
  if (immediateThreat) return [createAttackCommand(unit, immediateThreat)];

  let optimalTarget = findOptimalTarget(world, unit, weaponResults.targetableEnemyUnits, currentStep, MAX_DISTANCE);

  if (optimalTarget && optimalTarget.tag && typeof optimalTarget.unitType === 'number' && typeof unit.unitType === 'number' && unit.alliance !== undefined) {
    const unitDamagePerHit = worldService.getWeaponDamage(world, unit.unitType, unit.alliance, optimalTarget.unitType);
    if (unitDamagePerHit > 0) {
      setDamageForTag(optimalTarget.tag, unitDamagePerHit, currentStep);
      return [createAttackCommand(unit, optimalTarget)];
    }
  }

  // Default action: Attack the first enemy unit in range
  if (weaponResults.targetableEnemyUnits.length > 0) {
    return [createAttackCommand(unit, weaponResults.targetableEnemyUnits[0])];
  }

  return [];
}
/**
 * Creates an attack command for the given unit targeting another unit.
 *
 * @param {Unit} sourceUnit - The attacking unit.
 * @param {Unit} targetUnit - The target unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand} The created attack command.
 */
function createAttackCommand(sourceUnit, targetUnit) {
  const unitCommand = createUnitCommand(ATTACK_ATTACK, [sourceUnit]);
  unitCommand.targetUnitTag = targetUnit.tag;
  return unitCommand;
}
/**
 * Checks if the provided unit has all necessary data properties.
 * 
 * @param {Unit} unit - The unit object to check.
 * @returns {boolean} - Returns true if the unit has all required properties, otherwise false.
 */
function isUnitDataComplete(unit) {
  return Boolean(
    unit.pos &&
    unit.radius &&
    unit.unitType &&
    unit.alliance
  );
}

/**
 * Computes weapon results, specifically determining which enemy units are in weapon range,
 * which are targetable by weapon type, and if the target unit is in range.
 * @param {Unit} unit - The unit object.
 * @param {Unit} targetUnit - The target unit object.
 * @returns {{ targetUnitInRange: boolean, enemyUnitsInRange: Unit[], targetableEnemyUnits: Unit[] }}
 */
function computeWeaponsResults(unit, targetUnit) {
  const { pos, radius } = unit;
  const { weapons } = unit.data();

  if (!weapons || !pos || !targetUnit.pos) return {
    targetUnitInRange: false,
    enemyUnitsInRange: [],
    targetableEnemyUnits: []
  };

  const unitEffectiveRadius = radius || 0;
  const targetPos = targetUnit.pos;

  let targetUnitInRange = false;
  const enemyUnitsInRange = new Set();
  const targetableEnemyUnitsSet = new Set();

  weapons.forEach(weapon => {
    const { range, type } = weapon;
    if (range === undefined) return;

    const weaponRange = range + unitEffectiveRadius + (targetUnit.radius || 0);
    if (!targetUnitInRange) targetUnitInRange = getDistance(pos, targetPos) < weaponRange;

    const currentTargetableEnemyUnits = getTargetableEnemyUnits(type);
    currentTargetableEnemyUnits.forEach(targetableEnemyUnit => {
      targetableEnemyUnitsSet.add(targetableEnemyUnit);

      const { pos: enemyPos, radius: enemyUnitRadius } = targetableEnemyUnit;
      if (enemyPos === undefined || enemyUnitRadius === undefined) return;

      const targetableUnitEffectiveRadius = enemyUnitRadius || 0;
      const weaponRangeToMappedEnemyUnit = range + unitEffectiveRadius + targetableUnitEffectiveRadius;

      if (getDistance(pos, enemyPos) < weaponRangeToMappedEnemyUnit) {
        enemyUnitsInRange.add(targetableEnemyUnit);
      }
    });
  });

  return {
    targetUnitInRange: targetUnitInRange,
    enemyUnitsInRange: [...enemyUnitsInRange],
    targetableEnemyUnits: [...targetableEnemyUnitsSet]
  };
}


/**
 * @param {WeaponTargetType | undefined} weaponType
 * @returns {Unit[]}
 */
function getTargetableEnemyUnits(weaponType) {
  const { mappedEnemyUnits } = enemyTrackingService;
  switch (weaponType) {
    case WeaponTargetType.ANY:
      return mappedEnemyUnits;
    case WeaponTargetType.GROUND:
      return mappedEnemyUnits.filter(unit => !unit.isFlying);
    case WeaponTargetType.AIR:
      return mappedEnemyUnits.filter(unit => unit.isFlying);
    default:
      return [];
  }
}
/**
 * Compute the time required to kill a target with movement factored in.
 *
 * @param {World} world - The game world state.
 * @param {Unit} unit - The player's unit.
 * @param {Unit} target - The enemy unit to be targeted.
 * @param {number} currentDamage - The current cumulative damage on the enemy unit.
 * @returns {{ tag: string; timeToKillWithMovement: number; damagePotential: number } | null}
 */
function computeTimeToKillWithMovement(world, unit, target, currentDamage) {
  // Destructure required fields from unit and target for better readability
  const { unitType, alliance, pos, radius } = unit;
  const { health, shield, pos: enemyPos, radius: enemyRadius, unitType: enemyType, tag } = target;

  // Check for mandatory fields
  if (!unitType || !alliance || !pos || !radius || !health || !enemyPos || !enemyRadius || !enemyType || !tag) {
    return null;
  }

  const totalHealth = health + (shield ?? 0) - currentDamage;

  // Fetch weapon data
  const weapon = getWeapon(world.data, unit, target);
  if (!weapon || weapon.range === undefined || weapon.damage === undefined) return null;

  // Calculate enemy armor-adjusted damage
  const enemyArmor = (world.data.getUnitTypeData(enemyType)?.armor) || 0;
  const adjustedDamage = Math.max(1, weapon.damage - enemyArmor);

  // Fetch positions and speed for unit movement calculations
  const positions = enemyTrackingService.enemyUnitsPositions.get(tag);
  if (!positions?.current || !positions.previous) return null;

  const speed = unitService.getMovementSpeed(world.resources.get().map, unit, true);
  if (!speed) return null;

  // Compute movement related values
  const distanceToTarget = getDistance(pos, enemyPos);
  const distanceToEngage = distanceToTarget - radius - enemyRadius - weapon.range;
  const requiredDistance = Math.max(0, distanceToEngage);

  const elapsedFrames = positions.current.lastSeen - positions.previous.lastSeen;
  const enemySpeed = elapsedFrames ? (getDistance(pos, positions.current.pos) - getDistance(pos, positions.previous.pos)) / elapsedFrames : 0;
  const timeToReach = requiredDistance / Math.max(1e-6, speed - enemySpeed);

  // Compute adjusted DPS and time to kill
  const weaponsDPS = worldService.getWeaponDPS(world, unitType, alliance, [enemyType]);
  const adjustedDPS = weaponsDPS - enemyArmor * weaponsDPS / weapon.damage;
  const timeToKill = totalHealth / adjustedDPS;

  return { tag, timeToKillWithMovement: timeToKill + timeToReach, damagePotential: adjustedDamage };
}

/**
 * @param {Expansion[]} expansions
 * @returns {Point2D[]}
 */
function getCentroids(expansions) {
  return expansions.reduce((/** @type {Point2D[]} */acc, expansion) => {
    if (expansion.centroid) {
      acc.push(expansion.centroid);
    }
    return acc;
  }, []);
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} fromPos
 * @param {Point2D[]} toPoints
 * @returns {{ closestPosition: Point2D; distance: number; }}
 */
function calculateDistances(resources, fromPos, toPoints) {
  const { getClosestPositionByPath, getDistanceByPath } = resourceManagerService;
  const [closestPosition] = getClosestPositionByPath(resources, fromPos, toPoints);
  const distance = getDistanceByPath(resources, fromPos, closestPosition);
  return { closestPosition, distance };
}

/**
 * Tries to determine if enemyUnit is likely attacking targetUnit based on indirect information.
 * @param {DataStorage} data - The data required to get the attack range.
 * @param {Unit} enemyUnit - The enemy unit we're checking.
 * @param {Unit} targetUnit - The unit we want to see if it's being attacked by the enemyUnit.
 * @returns {boolean} - True if it seems the enemyUnit is attacking the targetUnit, false otherwise.
 */
function isActivelyAttacking(data, enemyUnit, targetUnit) {
  if (!enemyUnit.pos || !targetUnit.pos) {
    return false; // If position is undefined for either unit, they can't be actively attacking.
  }

  // Check if the enemy unit has weapons capable of attacking the target unit.
  const weaponThatCanAttack = unitService.getWeaponThatCanAttack(data, enemyUnit.unitType, targetUnit);
  if (!weaponThatCanAttack) {
    return false; // If enemy unit can't attack the target unit, then it's not a threat.
  }

  // Determine the dynamic threat range.
  const threatRange = calculateThreatRange(data, enemyUnit, targetUnit);

  // Check proximity based on the dynamic threat range.
  const distance = getDistance(enemyUnit.pos, targetUnit.pos);

  return distance <= threatRange;
}
/**
 * Calculate a dynamic threat range based on the enemy unit's characteristics.
 * @param {DataStorage} data - The data required to get the attack range.
 * @param {Unit} enemyUnit
 * @param {Unit} targetUnit
 * @returns {number} - The calculated threat range.
 */
function calculateThreatRange(data, enemyUnit, targetUnit) {
  const attackRange = dataService.getAttackRange(data, enemyUnit, targetUnit);

  // Get the projected position for the enemy unit.
  const targetPositions = enemyUnit.tag ? enemyTrackingService.enemyUnitsPositions.get(enemyUnit.tag) : null;
  const projectedTargetPosition = targetPositions ?
    getProjectedPosition(
      targetPositions.current.pos,
      targetPositions.previous.pos,
      targetPositions.current.lastSeen,
      targetPositions.previous.lastSeen
    ) : enemyUnit.pos;

  // If we can't determine a projected position, we'll stick to the current position
  const currentPosition = projectedTargetPosition || enemyUnit.pos;

  // This might overestimate the actual threat range a bit, but it's safer to be cautious.
  // Calculate anticipated movement as the distance between current position and projected position.
  let anticipatedMovement = 0;
  if (enemyUnit.pos && currentPosition) {
    anticipatedMovement = getDistance(enemyUnit.pos, currentPosition);
  }

  return attackRange + anticipatedMovement;
}
/**
 * Calculates the total DPS of a group of units based on enemy composition.
 * 
 * @param {World} world - The game world.
 * @param {Unit[]} unitsGroup - Array of units whose total DPS needs to be calculated.
 * @param {Unit[]} enemyUnits - Array of enemy units.
 * @returns {number} - Total DPS of the group against the provided enemy units.
 */
function calculateGroupDPS(world, unitsGroup, enemyUnits) {
  let totalDPS = 0;

  for (let unit of unitsGroup) {
    // Check if unitType is defined before proceeding
    if (unit.unitType !== undefined) {
      // Fetch the DPS values for each weapon of the unit type
      const unitDPSArray = getUnitDPS(world, unit.unitType);

      // If the unit has multiple weapons, choose the best one based on enemy composition
      const bestWeaponDPS = chooseBestWeaponDPS(unitDPSArray, enemyUnits);

      totalDPS += bestWeaponDPS;
    }
  }

  return totalDPS;
}
/**
 * Chooses the average of the best weapon's DPS against each enemy unit.
 * 
 * @param {import('../interfaces/weapon-dps').WeaponDPS[]} dpsArray - DPS values for each weapon of a unit.
 * @param {Unit[]} enemyUnits - Array of enemy units.
 * @returns {number} - Average of the best DPS values against each of the provided enemy units.
 */
function chooseBestWeaponDPS(dpsArray, enemyUnits) {
  let totalBestDPS = 0;

  for (let enemy of enemyUnits) {
    let bestDPSForEnemy = 0;
    let targetPreference = enemy.isFlying ? WeaponTargetType.AIR : WeaponTargetType.GROUND;

    for (let dps of dpsArray) {
      switch (targetPreference) {
        case WeaponTargetType.AIR:
          if (dps.type === WeaponTargetType.AIR && dps.dps > bestDPSForEnemy) {
            bestDPSForEnemy = dps.dps;
          }
          break;
        case WeaponTargetType.GROUND:
          if (dps.type === WeaponTargetType.GROUND && dps.dps > bestDPSForEnemy) {
            bestDPSForEnemy = dps.dps;
          }
          break;
        default:
          if (dps.dps > bestDPSForEnemy) {
            bestDPSForEnemy = dps.dps;
          }
          break;
      }
    }

    totalBestDPS += bestDPSForEnemy;
  }

  return enemyUnits.length > 0 ? totalBestDPS / enemyUnits.length : 0;
}
/**
 * Calculates the Damage Per Second (DPS) for each weapon of a given unit type.
 * 
 * @param {World} world - The game world.
 * @param {number} unitType - The type ID of the unit.
 * @returns {import('../interfaces/weapon-dps').WeaponDPS[]} - An array of DPS values for each weapon of the unit.
 */
function getUnitDPS(world, unitType) {
  // Fetch unit data
  const unitData = world.data.getUnitTypeData(unitType);

  // If the unit doesn't exist or doesn't have weapons, return an empty array
  if (!unitData?.weapons?.length) {
    return [];
  }

  // Map each weapon to its DPS
  const dpsArray = unitData.weapons.map(weapon => {
    // Using optional chaining to safely access properties
    const damage = weapon?.damage ?? 0;  // Default to 0 if undefined
    const speed = weapon?.speed ?? 1;    // Default to 1 if undefined to prevent division by zero
    const attacks = weapon?.attacks ?? 1; // Default to 1 if undefined

    // Compute DPS considering multiple attacks
    const dps = speed > 0 ? (damage * attacks) / speed : 0;

    // Generate a descriptor for the weapon
    const descriptor = `Type: ${weapon.type}, Damage: ${damage}, Range: ${weapon.range}, Speed: ${speed}, Attacks: ${attacks}`;

    return {
      name: descriptor,
      dps: dps,
      type: weapon?.type ?? WeaponTargetType.ANY, // default to ANY if type is undefined
    };
  });

  return dpsArray;
}
/**
 * Calculate the combined health and shields of a group of units.
 * @param {Unit[]} units
 * @returns {number}
 */
function calculateGroupHealthAndShields(units) {
  return units.reduce((total, unit) => total + (unit.health || 0) + (unit.shield || 0), 0);
}

/**
 * Return position away from multiple target positions.
 * @param {MapResource} map
 * @param {Point2D[]} targetPositions 
 * @param {Point2D} position 
 * @param {number} distance 
 * @param {boolean} isFlyingUnit 
 * @returns {Point2D | undefined}
 */
function moveAwayFromMultiplePositions(map, targetPositions, position, distance = 2, isFlyingUnit = false) {
  if (targetPositions.length === 0 || position.x === undefined || position.y === undefined) return;

  // Calculate the average threat direction
  let avgDX = 0;
  let avgDY = 0;
  for (const target of targetPositions) {
    if (target.x !== undefined && target.y !== undefined) {
      avgDX += target.x - position.x;
      avgDY += target.y - position.y;
    }
  }
  avgDX /= targetPositions.length;
  avgDY /= targetPositions.length;

  // Compute the point moving away from the threat direction
  const awayPoint = {
    x: position.x - avgDX * distance,
    y: position.y - avgDY * distance
  };

  const { x: mapWidth, y: mapHeight } = map.getSize();

  if (typeof mapWidth === 'undefined' || typeof mapHeight === 'undefined') {
    console.error("Map dimensions are undefined");
    return;
  }

  const clampedPoint = positionService.clampPointToBounds(awayPoint, 0, mapWidth, 0, mapHeight);

  // Skip pathability check for flying units
  if (isFlyingUnit) {
    return clampedPoint;
  }

  return map.isPathable(clampedPoint) ? clampedPoint : positionService.findPathablePointByAngleAdjustment(map, position, avgDX, avgDY, distance);
}
/**
 * Determine if the unit should fallback to a defensive position.
 * @param {World} world 
 * @param {Unit} selfUnit
 * @param {Unit} rangedUnitAlly
 * @param {Unit} targetUnit
 * @returns {boolean} - True if the unit should fallback, false otherwise.
 */
function shouldFallback(world, selfUnit, rangedUnitAlly, targetUnit) {
  const { pos: rangedUnitAllyPos, radius: rangedUnitAllyRadius } = rangedUnitAlly;
  if (!rangedUnitAllyPos || !rangedUnitAllyRadius) return false;
  return checkPositionValidityForAttack(world, selfUnit, rangedUnitAlly, targetUnit) === 'fallback';
}

/**
 * Returns necessary queens to engage in battle.
 * 
 * @param {World} world - The game world context.
 * @param {Unit[]} injectorQueens - Injector Queens.
 * @param {Unit[]} nonInjectorUnits - Units excluding Injector Queens.
 * @param {Unit[]} enemyUnits - Enemy units.
 * @returns {Unit[]} - Necessary queens required to engage.
 */
function getNecessaryQueens(world, injectorQueens, nonInjectorUnits, enemyUnits) {
  let necessaryQueens = [];
  for (const queen of injectorQueens) {
    const combinedUnits = [...nonInjectorUnits, ...necessaryQueens, queen];
    if (!worldService.shouldEngage(world, combinedUnits, enemyUnits)) {
      necessaryQueens.push(queen);
    } else {
      necessaryQueens.push(queen);
      break;
    }
  }
  return necessaryQueens;
}
/**
 * Finds an immediate threat among enemy units.
 * 
 * @param {DataStorage} data - Game data.
 * @param {Unit} unit - The player's unit.
 * @param {Unit[]} enemyUnits - Array of enemy units that can be targeted.
 * @returns {Unit|null} The immediate threat unit or null if not found.
 */
function findImmediateThreat(data, unit, enemyUnits) {
  for (const enemy of enemyUnits) {
    if (!enemy.pos || !unit.pos) continue; // Skip if either position is undefined
    const unitAttackRange = dataService.getAttackRange(data, unit, enemy);
    if (isActivelyAttacking(data, enemy, unit) && getDistance(unit.pos, enemy.pos) <= unitAttackRange) {
      return enemy;
    }
  }
  return null;
}
/**
 * Finds the optimal target based on the potential damage, health after the attack, and time to kill.
 *
 * @param {World} world - The game world state.
 * @param {Unit} unit - The player's unit.
 * @param {Unit[]} enemyUnits - Array of enemy units that can be targeted.
 * @param {number} currentStep - The current game step.
 * @param {number} maxDistance - The maximum distance to consider for engagement.
 * @returns {Unit|null} - The optimal target unit or null if not found.
 */
function findOptimalTarget(world, unit, enemyUnits, currentStep, maxDistance) {
  if (!unit.pos) return null;

  let optimalTarget = null;
  let smallestRemainingHealth = Infinity;
  let quickestTimeToKill = Infinity;  // Initialize to a high value for comparison

  const isValidEnemy = (/** @type {Unit} */ enemy) => enemy.pos && enemy.tag !== undefined;

  for (const enemy of enemyUnits) {
    if (!isValidEnemy(enemy)) continue;

    // Compute unitDamagePerHit for the current enemy in the loop
    const unitDamagePerHit = worldService.getWeaponDamage(world, unit.unitType, unit.alliance, enemy.unitType);

    const KILLING_BLOW_THRESHOLD = unitDamagePerHit;

    // Only calculate the distance if both unit.pos and enemy.pos are defined
    if (!unit.pos || !enemy.pos) continue;

    const distance = getDistance(unit.pos, enemy.pos);
    if (distance > maxDistance) continue;

    const enemyTag = /** @type {string} */ (enemy.tag);  // Type assertion
    const currentDamage = getDamageForTag(enemyTag, currentStep) || 0;
    const computation = computeTimeToKillWithMovement(world, unit, enemy, currentDamage);

    if (!computation?.tag) continue;

    const { timeToKillWithMovement, damagePotential } = computation;
    const potentialDamage = currentDamage + damagePotential;
    const remainingHealthAfterAttack = (enemy.health ?? 0) + (enemy.shield ?? 0) - potentialDamage;

    if (remainingHealthAfterAttack >= (0 - KILLING_BLOW_THRESHOLD) && remainingHealthAfterAttack <= 0
      || (remainingHealthAfterAttack < smallestRemainingHealth
        || timeToKillWithMovement < quickestTimeToKill)) {
      smallestRemainingHealth = remainingHealthAfterAttack;
      quickestTimeToKill = timeToKillWithMovement;
      optimalTarget = enemy;
    }
  }

  return optimalTarget;
}
/**
 * Process the logic for a single unit of the player.
 *
 * @param {World} world - The game world.
 * @param {Unit[]} selfUnits - Array of player units.
 * @param {Unit} selfUnit - The player's unit.
 * @param {Point2D} position - Point to either move towards or retreat from.
 * @param {Unit[]} enemyUnits - Array of enemy units.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - Array of collected actions.
 * @param {boolean} clearRocks - Indicates if destructible rocks should be targeted.
 */
function processSelfUnitLogic(world, selfUnits, selfUnit, position, enemyUnits, collectedActions, clearRocks) {
  const { workerTypes } = groupTypes;
  const { getInRangeDestructables, getMovementSpeed, getWeaponThatCanAttack, setPendingOrders } = unitService;
  const { microB, microRangedUnit, retreat } = worldService;
  const { data, resources } = world;
  const { map, units } = resources.get();
  const selfUnitsAttackingInRange = getUnitsAttackingInRange(world, selfUnits);
  const { pos, radius, tag } = selfUnit; if (pos === undefined || radius === undefined || tag === undefined) return;
  let targetPosition = position;
  // log condition if time is 215 to 245 seconds
  const logCondition = world.resources.get().frame.timeInSeconds() > 215 && world.resources.get().frame.timeInSeconds() < 245;
  if (!workerTypes.includes(selfUnit.unitType) || selfUnit.labels.has('defending')) {
    const [closestAttackableEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(enemyUnit => canAttack(selfUnit, enemyUnit, false)));
    const attackablePosition = closestAttackableEnemyUnit ? closestAttackableEnemyUnit.pos : null;
    if (closestAttackableEnemyUnit && distance(selfUnit.pos, closestAttackableEnemyUnit.pos) < 16) {
      const { pos: closestAttackableEnemyUnitPos, radius: closestAttackableEnemyUnitRadius, unitType: closestAttackableEnemyUnitType } = closestAttackableEnemyUnit; if (closestAttackableEnemyUnitPos === undefined || closestAttackableEnemyUnitRadius === undefined || closestAttackableEnemyUnitType === undefined) return;
      const engagementDistanceThreshold = 16; // Or whatever distance you choose
      const relevantSelfUnits = selfUnits.filter(unit => {
        if (!selfUnit.pos || !unit.pos) return false;
        return getDistance(unit.pos, selfUnit.pos) <= engagementDistanceThreshold;
      });
      const relevantEnemyUnits = enemyUnits.filter(unit => {
        if (unit.pos && selfUnit.pos) {
          return getDistance(unit.pos, selfUnit.pos) <= engagementDistanceThreshold;
        }
        return false;
      });
      const shouldEngageGroup = worldService.shouldEngage(world, relevantSelfUnits, relevantEnemyUnits);
      if (!shouldEngageGroup) {
        if (getMovementSpeed(map, selfUnit) < getMovementSpeed(map, closestAttackableEnemyUnit) && closestAttackableEnemyUnit.unitType !== ADEPTPHASESHIFT) {
          if (selfUnit.isMelee()) {
            collectedActions.push(...microB(world, selfUnit, closestAttackableEnemyUnit, enemyUnits));
          } else {
            const enemyInAttackRange = isEnemyInAttackRange(data, selfUnit, closestAttackableEnemyUnit);
            if (enemyInAttackRange) {
              collectedActions.push(...microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
            } else {
              const unitCommand = createUnitCommand(MOVE, [selfUnit]);
              unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestAttackableEnemyUnit]);
              collectedActions.push(unitCommand);
            }
          }
        } else {
          const unitCommand = createUnitCommand(MOVE, [selfUnit]);
          if (selfUnit.isFlying) {
            if (attackablePosition) {
              createAndAddUnitCommand(MOVE, selfUnit, moveAwayPosition(map, attackablePosition, pos), collectedActions);
            }
          } else {
            if (selfUnit['pendingOrders'] === undefined || selfUnit['pendingOrders'].length === 0) {
              const closestEnemyRange = getClosestEnemyByRange(world, selfUnit, enemyUnits); if (closestEnemyRange === null) return;
              const { pos: closestEnemyRangePos } = closestEnemyRange; if (closestEnemyRangePos === undefined) return;
              if (!selfUnit.isMelee()) {
                const foundEnemyWeapon = getWeaponThatCanAttack(data, closestEnemyRange.unitType, selfUnit);
                if (foundEnemyWeapon) {
                  const bufferDistance = (foundEnemyWeapon.range + radius + closestEnemyRange.radius + getTravelDistancePerStep(map, closestEnemyRange) + getTravelDistancePerStep(map, selfUnit) * 1.1);
                  if ((bufferDistance) < getDistance(pos, closestEnemyRangePos)) {
                    // Check for ally units in the path
                    const pathToEnemy = MapResourceService.getMapPath(map, pos, closestEnemyRangePos);
                    if (pos && pos.x !== undefined && pos.y !== undefined) {
                      const offset = {
                        x: pos.x - Math.floor(pos.x),
                        y: pos.y - Math.floor(pos.y),
                      };

                      /**
                       * @param {Unit} unit 
                       * @returns {boolean}
                       */
                      const isNotAttackingNorHasAttackOrder = (unit) => {
                        // Replace this with your own function to check if the unit is not attacking and does not have a pending attack order
                        return !unit.isAttacking() && !unitService.getPendingOrders(unit).some(order => order.abilityId === ATTACK_ATTACK);
                      }

                      const allyUnitsInPath = selfUnits.filter(unit => {
                        return getPathCoordinates(pathToEnemy).some(pathPos => {
                          if (pathPos.x !== undefined && pathPos.y !== undefined) {
                            const adjustedPathPos = {
                              x: pathPos.x + offset.x,
                              y: pathPos.y + offset.y,
                            };

                            return unit.pos && getDistance(adjustedPathPos, unit.pos) <= (unit.radius !== undefined ? unit.radius : 0.5);
                          }
                          return false;
                        });
                      }).filter(isNotAttackingNorHasAttackOrder);

                      if (allyUnitsInPath.length === 0) {
                        // If no ally units are in the path, proceed with micro
                        collectedActions.push(...microRangedUnit(world, selfUnit, closestEnemyRange));
                      } else {
                        // If ally units are in the path, set the target world space position to retreat
                        unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                        unitCommand.unitTags = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                          setPendingOrders(unit, unitCommand);
                          return unit.tag;
                        });
                      }
                    }

                    return;
                  } else {
                    // retreat if buffer distance is greater than actual distance
                    unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestEnemyRange] || [closestAttackableEnemyUnit]);
                    unitCommand.unitTags = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                      setPendingOrders(unit, unitCommand);
                      return unit.tag;
                    });
                  }
                } else {
                  // no weapon found, micro ranged unit
                  collectedActions.push(...microRangedUnit(world, selfUnit, closestEnemyRange || closestAttackableEnemyUnit));
                  return;
                }
              } else {
                // retreat if melee
                unitCommand.targetWorldSpacePos = retreat(world, selfUnit, [closestEnemyRange || closestAttackableEnemyUnit]);
              }
            } else {
              // skip action if pending orders
              return;
            }
          }
          collectedActions.push(unitCommand);
        }
      } else {
        setRecruitToBattleLabel(selfUnit, attackablePosition);
        if (canAttack(selfUnit, closestAttackableEnemyUnit, false)) {
          if (!selfUnit.isMelee()) {
            collectedActions.push(...microRangedUnit(world, selfUnit, closestAttackableEnemyUnit));
          } else {
            handleMeleeUnitLogic(world, selfUnit, closestAttackableEnemyUnit, attackablePosition, collectedActions);
          }
        } else {
          collectedActions.push({
            abilityId: ATTACK_ATTACK,
            targetWorldSpacePos: attackablePosition,
            unitTags: [tag],
          });
        }
      }
    } else {
      if (selfUnit.unitType !== QUEEN) {
        const unitCommand = {
          abilityId: ATTACK_ATTACK,
          unitTags: [tag],
        }
        const destructableTag = getInRangeDestructables(units, selfUnit);
        if (destructableTag && clearRocks && !worldService.outpowered) {
          const destructable = units.getByTag(destructableTag);
          const { pos, radius } = destructable; if (pos === undefined || radius === undefined) { return; }
          const { pos: selfPos, radius: selfRadius, unitType: selfUnitType } = selfUnit; if (selfPos === undefined || selfRadius === undefined || selfUnitType === undefined) { return; }
          const weapon = getWeaponThatCanAttack(data, selfUnitType, destructable); if (weapon === undefined) { return; }
          const { range } = weapon; if (range === undefined) { return; }
          const attackRadius = radius + selfRadius + range;
          const destructableBorderPositions = getBorderPositions(pos, attackRadius);
          const fitablePositions = destructableBorderPositions.filter(borderPosition => {
            return selfUnitsAttackingInRange.every(attackingInRangeUnit => {
              const { pos: attackingInRangePos, radius: attackingInRangeRadius } = attackingInRangeUnit; if (attackingInRangePos === undefined || attackingInRangeRadius === undefined) { return false; }
              const distanceFromAttackingInRangeUnit = getDistance(borderPosition, attackingInRangePos);
              return distanceFromAttackingInRangeUnit > attackingInRangeRadius + selfRadius;
            });
          }).sort((a, b) => getDistance(a, selfPos) - getDistance(b, selfPos));
          if (fitablePositions.length > 0 && getDistance(pos, selfPos) > attackRadius + 1) {
            targetPosition = fitablePositions[0];
            const moveUnitCommand = createUnitCommand(MOVE, [selfUnit]);
            moveUnitCommand.targetWorldSpacePos = targetPosition;
            collectedActions.push(moveUnitCommand);
            unitCommand.queueCommand = true;
          }
          unitCommand.targetUnitTag = destructable.tag;
        }
        else {
          const [closestCompletedBunker] = units.getClosest(selfUnit.pos, units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1));
          if (closestCompletedBunker && closestCompletedBunker.abilityAvailable(LOAD_BUNKER)) {
            unitCommand.abilityId = SMART;
            unitCommand.targetUnitTag = closestCompletedBunker.tag;
          } else {
            unitCommand.targetWorldSpacePos = targetPosition;
          }
        }
        collectedActions.push(unitCommand);
      }
    }
  }
  // if selfUnit is a QUEEN and logCondition is true, log its collectedActions
  if (selfUnit.unitType === QUEEN && logCondition) {
    const queenActions = collectedActions.filter(action => action.unitTags && action.unitTags.includes(tag));
    console.log(`Queen ${tag} collectedActions: ${JSON.stringify(queenActions)}`);
  }
}
/**
 * Returns a nearby pathable position given an unpathable position.
 *
 * @param {World} world - The game world data.
 * @param {Point2D} unpathablePoint - The unpathable position.
 * @param {number} maxSearchRadius - The maximum radius to search for a pathable point.
 * @returns {Point2D | undefined} - A nearby pathable position or undefined if none found.
 */
function findNearbyPathablePosition(world, unpathablePoint, maxSearchRadius = 5) {
  if (unpathablePoint.x === undefined || unpathablePoint.y === undefined) {
    return undefined; // Or throw an error, depending on your use case
  }

  const { map } = world.resources.get();
  for (let r = 1; r <= maxSearchRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
          continue; // Only consider points on the outer perimeter of the search area
        }
        const testPoint = {
          x: unpathablePoint.x + dx,
          y: unpathablePoint.y + dy
        };
        if (map.isPathable(testPoint)) {
          return testPoint;
        }
      }
    }
  }
  return undefined;
}
/**
 * Identify enemy units in proximity to a primary target.
 *
 * @param {World} _world The current game state.
 * @param {Unit} _unit The unit we're focusing on.
 * @param {Unit} targetUnit The primary enemy unit we're concerned about.
 * @returns {Unit[]} Array of enemy units near the target.
 */
function findNearbyThreats(_world, _unit, targetUnit) {
  const NEARBY_THRESHOLD = 16; // Define the threshold value based on the game's logic

  // Use the enemy tracking service to get all enemy units
  const allEnemyUnits = enemyTrackingService.mappedEnemyUnits;

  return allEnemyUnits.filter((enemy) => {
    const { tag, pos } = enemy;

    // Use early returns to filter out non-threatening or irrelevant units
    if (tag === targetUnit.tag || isNonThreateningUnit(enemy)) {
      return false;
    }

    // Check proximity to target unit
    return getDistance(pos, targetUnit.pos) <= NEARBY_THRESHOLD;
  });
}
/**
 * Determine if the provided unit is considered non-threatening, such as workers.
 *
 * @param {Unit} unit - The unit to evaluate.
 * @returns {boolean} - True if the unit is non-threatening; otherwise, false.
 */
function isNonThreateningUnit(unit) {
  return groupTypes.workerTypes.includes(unit.unitType);
}
/**
 * Check if the path to a given location is safe.
 * 
 * @param {World} world - The game world containing various game state information.
 * @param {Unit} unit - The unit that we're considering moving.
 * @param {Point2D} location - The destination point that we're evaluating the safety of reaching.
 * @returns {boolean} - Returns true if the path is deemed safe, and false otherwise.
 */
const isPathSafe = (world, unit, location) => {
  const { resources } = world;
  const { map } = resources.get();
  const { pos: unitPos } = unit;

  if (!unitPos) return false;

  // Obtain the path using your existing getMapPath function
  const path = MapResourceService.getMapPath(map, unitPos, location);

  // Convert path to an array of Point2D for easier handling
  const pathPoints = path.map(coord => ({ x: coord[0], y: coord[1] }));

  const aliveEnemies = resources.get().units.getAlive(Alliance.ENEMY).filter(e => e.pos);

  if (!aliveEnemies.length) return true; // Return early if there are no live enemies

  return !pathPoints.some(point => {
    const closestEnemies = resources.get().units.getClosest(point, aliveEnemies);

    if (!closestEnemies.length) return false;

    const closestEnemy = closestEnemies[0];
    const { unitType, pos: enemyPos } = closestEnemy;

    if (!enemyPos || typeof unitType !== 'number') return false;

    // Projected position logic can be added here if needed
    // const projectedEnemyPos = getProjectedPosition(...);

    const weapon = unitService.getWeaponThatCanAttack(world.data, unitType, unit);
    const attackRange = weapon?.range;

    if (!attackRange) return false;

    const effectiveAttackRange = attackRange + (unit.radius || 0) + (closestEnemy.radius || 0);
    const distance = getDistance(point, enemyPos);

    if (distance <= effectiveAttackRange) {
      const directionToEnemy = subtractVectors(enemyPos, unitPos);
      const directionOfMovement = subtractVectors(point, unitPos);

      return dotVectors(directionToEnemy, directionOfMovement) < 0;
    }

    return false;
  });
};
/**
 * Calculates the optimal distance a unit should maintain from enemies to effectively utilize its attack range.
 *
 * @param {World} world - The current state of the game world.
 * @param {Unit} unit - The unit being controlled.
 * @param {Unit[]} enemies - Array of enemy units that pose a threat.
 * @returns {number} - The calculated optimal distance from the enemies.
 */
function getOptimalAttackDistance(world, unit, enemies) {
  const { data } = world;
  const unitWeapon = unitService.getWeaponThatCanAttack(data, unit.unitType, enemies[0]); // Assuming enemies[0] as the reference enemy for simplicity

  if (!unitWeapon || !unitWeapon.range) {
    return 0; // Handle the case where the weapon or range is undefined
  }

  const unitAttackRange = unitWeapon.range;

  // Calculate the minimal attack range among the enemies
  const enemyAttackRanges = enemies.map(enemy => {
    const enemyWeapon = unitService.getWeaponThatCanAttack(data, enemy.unitType, unit); // Getting the weapon that can attack our unit
    return enemyWeapon ? enemyWeapon.range : 0;
  });

  const minEnemyAttackRange = Math.min(...enemyAttackRanges);

  return unitAttackRange + minEnemyAttackRange; // This is a basic example, adapt as needed
}