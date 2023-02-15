//@ts-check
"use strict"

const fs = require('fs');
const { UnitTypeId, Ability, UnitType, Buff, WarpUnitAbility } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK, STOP, CANCEL_QUEUE5, TRAIN_ZERGLING, RALLY_BUILDING } = require("@node-sc2/core/constants/ability");
const { Race, Attribute, Alliance, WeaponTargetType, RaceId } = require("@node-sc2/core/constants/enums");
const { reactorTypes, techLabTypes, mineralFieldTypes, workerTypes, townhallTypes, constructionAbilities, liftingAbilities, landingAbilities, gasMineTypes, rallyWorkersAbilities, addonTypes } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints, createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { countTypes, morphMapping, addOnTypesMapping, flyingTypesMapping } = require("../helper/groups");
const { getCandidatePositions, getInTheMain } = require("../helper/placement/placement-helper");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine, getResourceDemand } = require("../systems/manage-resources");
const { createUnitCommand } = require("./actions-service");
const dataService = require("./data-service");
const { formatToMinutesAndSeconds, getStringNameOfConstant } = require("./logging-service");
const loggingService = require("./logging-service");
const planService = require("./plan-service");
const { isPendingContructing } = require("./shared-service");
const unitService = require("../systems/unit-resource/unit-resource-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel, getWeaponThatCanAttack, getMovementSpeed, isMoving, getPendingOrders, getHighestRangeWeapon, getBuildTimeLeft, isConstructing } = require("./unit-service");
const { GasMineRace, WorkerRace, SupplyUnitRace, TownhallRace } = require("@node-sc2/core/constants/race-map");
const { calculateHealthAdjustedSupply, getInRangeUnits } = require("../helper/battle-analysis");
const { filterLabels } = require("../helper/unit-selection");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const { getPathablePositionsForStructure, getClosestExpansion, getPathablePositions, isInMineralLine, isPlaceableAtGasGeyser } = require("./map-resource-service");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getOccupiedExpansions, getNextSafeExpansion, getAvailableExpansions } = require("../helper/expansions");
const { existsInMap } = require("../helper/location");
const { pointsOverlap, shuffle } = require("../helper/utilities");
const wallOffNaturalService = require("../systems/wall-off-natural/wall-off-natural-service");
const { findWallOffPlacement } = require("../systems/wall-off-ramp/wall-off-ramp-service");
const getRandom = require("@node-sc2/core/utils/get-random");
const { SPAWNINGPOOL, ADEPT, EGG, DRONE, ZERGLING, PROBE, REACTOR, CREEPTUMORQUEEN, BARRACKS, SUPPLYDEPOT, ENGINEERINGBAY, FORGE, CREEPTUMOR, WARPGATE, PYLON, OVERLORD, GREATERSPIRE, TECHLAB, ORBITALCOMMAND, SCV } = require("@node-sc2/core/constants/unit-type");
const scoutingService = require("../systems/scouting/scouting-service");
const { getTimeInSeconds, getTravelDistancePerStep } = require("./frames-service");
const scoutService = require("../systems/scouting/scouting-service");
const path = require('path');
const foodUsedService = require('./food-used-service');
const { keepPosition } = require('./placement-service');
const trackUnitsService = require('../systems/track-units/track-units-service');
const { canAttack } = require('./resources-service');
const { getMiddleOfStructure, moveAwayPosition, getDistance } = require('./position-service');
const { micro } = require('./micro-service');
const MapResourceService = require('./map-resource-service');
const { getPathCoordinates } = require('./path-service');
const resourceManagerService = require('./resource-manager-service');
const { getAddOnPlacement, getAddOnBuildingPosition, getAddOnBuildingPlacement } = require('../helper/placement/placement-utilities');
const { getEnemyUnits } = require('../systems/state-of-game-system/state-of-game-service');
const wallOffRampService = require('../systems/wall-off-ramp/wall-off-ramp-service');
const { getUnitWeaponDistanceToPosition, isTrainingUnit, earmarkThresholdReached, getEarmarkedFood } = require('./data-service');
const unitTrainingService = require('../systems/unit-training/unit-training-service');
const { haveAvailableProductionUnitsFor } = require('../systems/unit-training/unit-training-service');
const { checkUnitCount } = require('../systems/track-units/track-units-service');
const { convertLegacyStep } = require('./plan-service');

const worldService = {
  /** @type {number} */
  foodUsed: 0,
  /** @type {boolean} */
  outpowered: false,
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
    const collectedActions = [];
    const { data, resources } = world;
    const { units } = resources.get();
    const { setPendingOrders } = unitResourceService;
    let canDoTypes = data.findUnitTypesWithAbility(abilityId).reduce((/** @type {UnitTypeId[]} */acc, unitTypeId) => {
      acc.push(unitTypeId);
      const key = [...flyingTypesMapping.keys()].find(key => flyingTypesMapping.get(key) === unitTypeId);
      if (key) acc.push(key);
      return acc;
    }, []);
    if (canDoTypes.length === 0) {
      canDoTypes = units.getAlive(Alliance.SELF).map(selfUnits => selfUnits.unitType);
    }
    const unitsCanDo = units.getById(canDoTypes);
    if (unitsCanDo.length > 0) {
      if (unitsCanDo.filter(unit => unit.abilityAvailable(abilityId)).length > 0) {
        let unitCanDo = unitsCanDo[Math.floor(Math.random() * unitsCanDo.length)];
        const unitCommand = { abilityId, unitTags: [unitCanDo.tag] }
        collectedActions.push(unitCommand);
      } else {
        // unitsCanDo may not have ability available, due to being busy or tech not available yet
        // if idle, give it pending order
        const idleUnits = unitsCanDo.filter(unit => unit.isIdle);
        if (idleUnits.length > 0) {
          const unit = idleUnits[Math.floor(Math.random() * idleUnits.length)];
          const unitCommand = createUnitCommand(abilityId, [unit]);
          setPendingOrders(unit, unitCommand);
        }
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
    const { data, resources } = world;
    const { actions, map } = resources.get();
    const { setPendingOrders } = unitResourceService;
    for (const [key, value] of countTypes.entries()) {
      if (value.includes(addOnType)) {
        addOnType = key;
        break;
      }
    }
    const unitTypeToBuild = UnitType[`${UnitTypeId[flyingTypesMapping.get(unit.unitType) || unit.unitType]}${UnitTypeId[addOnType]}`];
    let { abilityId } = data.getUnitTypeData(unitTypeToBuild);
    if (unit.noQueue && !unit.labels.has('swapBuilding')) {
      if (unit.availableAbilities().some(ability => ability === abilityId)) {
        const unitCommand = {
          abilityId,
          unitTags: [unit.tag]
        }
        const addonPlacement = getAddOnPlacement(unit.pos);
        const addOnFootprint = getFootprint(addOnType);
        if (addOnFootprint === undefined) return;
        const canPlace = map.isPlaceableAt(addOnType, addonPlacement) && !pointsOverlap(cellsInFootprint(addonPlacement, addOnFootprint), unitResourceService.seigeTanksSiegedGrids);
        console.log('map.isPlaceableAt(addOnType, addonPlacement)', map.isPlaceableAt(addOnType, addonPlacement));
        console.log(!pointsOverlap(cellsInFootprint(addonPlacement, addOnFootprint), unitResourceService.seigeTanksSiegedGrids));
        if (canPlace) {
          unitCommand.targetWorldSpacePos = unit.pos;
          await actions.sendAction(unitCommand);
          planService.pausePlan = false;
          setPendingOrders(unit, unitCommand);
          worldService.addEarmark(data, data.getUnitTypeData(addOnType));
          return;
        }
      }
      if (unit.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !unit.labels.has('pendingOrders')) {
        const addOnPosition = unit.labels.get('addAddOn');
        if (addOnPosition && distance(getAddOnPlacement(unit.pos), addOnPosition) < 1) {
          unit.labels.delete('addAddOn');
        } else {
          const unitCommand = {
            abilityId: Ability.LIFT,
            unitTags: [unit.tag],
          }
          await actions.sendAction(unitCommand);
          setPendingOrders(unit, unitCommand);
        }
      }
      if (unit.availableAbilities().find(ability => landingAbilities.includes(ability))) {
        const foundPosition = await worldService.checkAddOnPlacement(world, unit, addOnType);
        if (foundPosition) {
          unit.labels.set('addAddOn', foundPosition);
          const unitCommand = {
            abilityId: abilityId,
            unitTags: [unit.tag],
            targetWorldSpacePos: foundPosition
          }
          await actions.sendAction(unitCommand);
          planService.pausePlan = false;
          setPendingOrders(unit, unitCommand);
          addEarmark(data, data.getUnitTypeData(addOnType));
        }
      }
    }
  },
  /**
 * 
 * @param {DataStorage} data 
 * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
 */
  addEarmark: (data, orderData) => {
    const { getFoodUsed } = worldService;
    if (dataService.earmarkThresholdReached(data)) return;
    const { name, mineralCost, vespeneCost } = orderData; if (name === undefined || mineralCost === undefined || vespeneCost === undefined) return;
    let minerals = 0;
    const key = `${planService.currentStep}_${getFoodUsed() + dataService.getEarmarkedFood()}`
    if (orderData['unitId'] !== undefined) {
      /** @type {SC2APIProtocol.UnitTypeData} */
      const { attributes, foodRequired, race, unitId } = orderData; if (attributes === undefined || foodRequired === undefined || race === undefined || unitId === undefined) return;
      const foodEarmark = dataService.foodEarmarks.get(key) || 0;
      dataService.foodEarmarks.set(key, foodEarmark + foodRequired);
      minerals = (unitId === ORBITALCOMMAND ? -400 : 0)
      if (race === Race.ZERG && attributes.includes(Attribute.STRUCTURE)) {
        const foodEarmark = dataService.foodEarmarks.get(key) || 0;
        dataService.foodEarmarks.set(key, foodEarmark - 1);
      }
    }
    minerals += mineralCost;
    // set earmark name to include step number and food used plus food earmarked
    const earmarkName = `${name}_${key}`;
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
  assignAndSendWorkerToBuild: (world, unitType, position, getMiddle=true) => {
    const { agent, data, resources } = world;
    const { race } = agent;
    const { units } = resources.get();
    const { setPendingOrders } = unitResourceService;
    const { abilityId } = data.getUnitTypeData(unitType);
    const { getBuilder } = worldService;
    const collectedActions = [];
    position = getMiddle ? getMiddleOfStructure(position, unitType) : position;
    const builder = getBuilder(world, position);
    if (builder) {
      const { unit } = builder;
      const { pos } = unit;
      if (pos === undefined) return collectedActions;
      worldService.addEarmark(data, data.getUnitTypeData(unitType));
      if (!unit.isConstructing() && !isPendingContructing(unit)) {
        setBuilderLabel(unit);
        const unitCommand = createUnitCommand(abilityId, [unit]);
        if (GasMineRace[agent.race] === unitType) {
          const [closestGasGeyser] = units.getClosest(position, units.getGasGeysers()); if (closestGasGeyser === undefined) return collectedActions;
          const { pos } = closestGasGeyser; if (pos === undefined) return collectedActions;
          unitCommand.targetUnitTag = closestGasGeyser.tag;
          collectedActions.push(unitCommand);
        } else {
          unitCommand.targetWorldSpacePos = position;
          collectedActions.push(unitCommand);
        }
        console.log(`Command given: ${Object.keys(Ability).find(ability => Ability[ability] === abilityId)}`);
        if (TownhallRace[race].indexOf(unitType) === 0) {
          resourceManagerService.availableExpansions = [];
        }
        setPendingOrders(unit, unitCommand);
        collectedActions.push(...unitService.stopOverlappingBuilders(units, unit, position));
      }
    }
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
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const { addEarmark, addAddOn, checkBuildingCount, findAndPlaceBuilding, getUnitsCanDoWithAddOnAndIdle, getUnitsCanDoWithoutAddOnAndIdle, morphStructureAction } = worldService;
    if (checkBuildingCount(world, unitType, targetCount) || targetCount === null) {
      const { race } = agent;
      switch (true) {
        case TownhallRace[race].includes(unitType):
          if (TownhallRace[race].indexOf(unitType) === 0) {
            if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
              candidatePositions = await getInTheMain(resources, unitType);
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
            } else {
              const availableExpansions = getAvailableExpansions(resources);
              candidatePositions = availableExpansions.length > 0 ? [await getNextSafeExpansion(world, availableExpansions)] : [];
              collectedActions.push(...await findAndPlaceBuilding(world, unitType, candidatePositions));
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
          if (agent.canAfford(unitType)) {
            const abilityIds = worldService.getAbilityIdsForAddons(data, unitType);
            const canDoTypes = worldService.getUnitTypesWithAbilities(data, abilityIds);
            const canDoTypeUnits = units.getById(canDoTypes);
            const unitsCanDoWithoutAddOnAndIdle = getUnitsCanDoWithoutAddOnAndIdle(world, unitType);
            const unitsCanDoIdle = unitsCanDoWithoutAddOnAndIdle.length > 0 ? unitsCanDoWithoutAddOnAndIdle : getUnitsCanDoWithAddOnAndIdle(canDoTypeUnits);
            addEarmark(data, data.getUnitTypeData(unitType));
            if (unitsCanDoIdle.length > 0) {
              let unitCanDo = unitsCanDoIdle[Math.floor(Math.random() * unitsCanDoIdle.length)];
              await addAddOn(world, unitCanDo, unitType);
            } else {
              const busyCanDoUnits = canDoTypeUnits.filter(unit => unit.addOnTag === '0').filter(unit => isTrainingUnit(data, unit));
              const randomBusyTrainingUnit = getRandom(busyCanDoUnits); if (randomBusyTrainingUnit === undefined || randomBusyTrainingUnit.orders === undefined) return;
              const { orders } = randomBusyTrainingUnit;
              const { progress } = orders[0]; if (progress === undefined) return;
              if (!worldService.outpowered && progress <= 0.5) {
                await actions.sendAction(createUnitCommand(CANCEL_QUEUE5, [randomBusyTrainingUnit]));
              }
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
    await actions.sendAction(collectedActions);
  },
  /**
   * @param {World} world 
   * @param {number} limit
   * @param {boolean} checkCanBuild
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  buildWorkers: (world, limit=1, checkCanBuild=false) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const { setPendingOrders } = unitResourceService;
    const { canBuild } = worldService;
    const collectedActions = [];
    const workerTypeId = WorkerRace[agent.race];
    if (canBuild(world, workerTypeId) || checkCanBuild) {
      const { abilityId } = data.getUnitTypeData(workerTypeId);
      if (abilityId === undefined) return collectedActions;
      let trainers = [];
      if (agent.race === Race.ZERG) {
        trainers = units.getById(UnitType.LARVA).filter(larva => !larva['pendingOrders'] || larva['pendingOrders'].length === 0);
      } else {
        trainers = units.getById(townhallTypes, { alliance: Alliance.SELF, buildProgress: 1, noQueue: true })
          .filter(townhall => townhall.abilityAvailable(abilityId) && !townhall['pendingOrders'] || townhall['pendingOrders'].length === 0);
      }
      if (trainers.length > 0) {
        trainers = shuffle(trainers);
        trainers = trainers.slice(0, limit);
        trainers.forEach(trainer => {
          const unitCommand = createUnitCommand(abilityId, [trainer]);
          collectedActions.push(unitCommand);
          setPendingOrders(trainer, unitCommand);
          const { foodRequired } = data.getUnitTypeData(workerTypeId); if (foodRequired === undefined) return collectedActions;
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
 * @returns 
 */
  checkAddOnPlacement: async (world, building, addOnType = REACTOR) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const { findPosition } = worldService;
    const abilityIds = worldService.getAbilityIdsForAddons(data, addOnType);
    if (abilityIds.some(abilityId => building.abilityAvailable(abilityId))) {
      let position = null;
      let addOnPosition = null;
      let range = 1;
      do {
        const nearPoints = gridsInCircle(getAddOnPlacement(building.pos), range).filter(grid => {
          const addOnBuildingPlacementsForOrphanAddOns = units.getAlive(Alliance.SELF).filter(techLab => techLab.unitType === TECHLAB).reduce((acc, techLab) => {
            return [...acc, ...cellsInFootprint(getAddOnBuildingPlacement(techLab.pos), { h: 3, w: 3 })];
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
            addOnPosition = await findPosition(world, addOnType, nearPoints);
            if (addOnPosition) {
              position = await findPosition(world, building.unitType, [getAddOnBuildingPlacement(addOnPosition)]);
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
   * @param {World} world
   * @param {number} unitType
   * @param {Point2D[]} candidatePositions
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  findAndPlaceBuilding: async (world, unitType, candidatePositions) => {
    const { agent, data, resources } = world;
    const { actions, units } = resources.get();
    const { findPosition } = worldService;
    const collectedActions = []
    let position = planService.buildingPosition;
    const validPosition = position && keepPosition(world, unitType, position);
    if (!validPosition) {
      if (candidatePositions.length === 0) {
        candidatePositions = await worldService.findPlacements(world, unitType);
      }
      position = await findPosition(world, unitType, candidatePositions);
      if (!position) {
        candidatePositions = await worldService.findPlacements(world, unitType);
        position = await findPosition(world, unitType, candidatePositions, true);
      }
      planService.buildingPosition = position;
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
            planService.buildingPosition = position;
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
      const [pylon] = units.getById(UnitType.PYLON);
      if (pylon && pylon.buildProgress < 1) {
        collectedActions.push(...worldService.premoveBuilderToPosition(world, pylon.pos, pylon.unitType));
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  },
  /**
   *
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @returns {Promise<Point2D[]>}
   */
  findPlacements: async (world, unitType) => {
    const { agent, data, resources } = world;
    const { race } = agent;
    const { actions, map, units } = resources.get();
    const [main, natural] = map.getExpansions(); if (main === undefined || natural === undefined) { return []; }
    const mainMineralLine = main.areas.mineralLine;
    if (gasMineTypes.includes(unitType)) {
      const geyserPositions = map.freeGasGeysers().map(geyser => {
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
      if (unitType === UnitType.PYLON) {
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
        if (units.getById(UnitType.PYLON).length === 1) {
          pylonsNearProduction = units.getById(UnitType.PYLON);
        } else {
          pylonsNearProduction = units.getById(UnitType.PYLON)
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
      const wallOffPositions = findWallOffPlacement(unitType).slice();
      if (wallOffPositions.length > 0 && await actions.canPlace(unitType, wallOffPositions)) {
        return wallOffPositions;
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
      placements = placementGrids.filter(grid => {
        const cells = [...cellsInFootprint(grid, unitTypeFootprint)];
        if (addonFootprint) {
          cells.push(...cellsInFootprint(getAddOnPlacement(grid), addonFootprint));
        }
        return cells.every(cell => map.isPlaceable(cell)) && !pointsOverlap(cells, [...wallOffPositions]);
      }).map(pos => ({ pos, rand: Math.random() }))
        .sort((a, b) => a.rand - b.rand)
        .map(a => a.pos)
        .slice(0, 20);
    } else if (race === Race.ZERG) {
      placements.push(...findZergPlacements(resources, unitType))
    }
    return placements;
  },
  /**
   * @param {World} world
   * @param {Unit} unit 
   * @param {number} radius
   * @returns {Point2D|undefined}
   */
  findClosestSafePosition: (world, unit, radius = 1) => {
    const { resources } = world;
    const { getClosestPositionByPath } = resourceManagerService;
    const safePositions = getSafePositions(world, unit, radius);
    if (unit.isFlying) {
      const [closestPoint] = getClosestPosition(unit.pos, safePositions);
      return closestPoint;
    } else {
      const [closestPoint] = getClosestPositionByPath(resources, unit.pos, safePositions);
      return closestPoint;
    }
  },
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {Point3D[]} candidatePositions
   * @returns {Promise<false | Point2D>}
   */
  findPosition: async (world, unitType, candidatePositions) => {
    if (candidatePositions.length === 0) return false;
    const { resources, agent } = world;
    const { actions, map } = resources.get();
    if (flyingTypesMapping.has(unitType)) {
      const baseUnitType = flyingTypesMapping.get(unitType);
      unitType = baseUnitType === undefined ? unitType : baseUnitType;
    }
    const isProtoss = agent.race === Race.PROTOSS;
    if (isProtoss) {
      candidatePositions = candidatePositions.filter(position => map.isPlaceableAt(unitType, position) || isPlaceableAtGasGeyser(map, unitType, position));
    }
    const randomPositions = candidatePositions
      .map(pos => ({ pos, rand: Math.random() }))
      .sort((a, b) => a.rand - b.rand)
      .map(a => a.pos)
      .slice(0, 20);
    let foundPosition = isProtoss ? getRandom(randomPositions) : await actions.canPlace(unitType, randomPositions);
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
    const { data, resources } = world;
    const { map, units } = resources.get();
    const { getClosestPathablePositionsBetweenPositions, getClosestUnitByPath, getClosestUnitPositionByPath, getDistanceByPath } = resourceManagerService;
    const { getBuilders } = unitResourceService;
    let builderCandidates = getBuilders(units);
    /** @type {Unit[]} */
    const movingOrConstructingNonDrones = [];
    builderCandidates.push(...units.getWorkers().filter(worker => {
      const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
      const gatheringAndNotMining = worker.isGathering() && !unitResourceService.isMining(units, worker);
      const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === PROBE;
      const isConstructingSCV = isConstructing(worker, true) && worker.unitType === SCV;
      if (isConstructingOrMovingProbe || isConstructingSCV) movingOrConstructingNonDrones.push(worker);
      const available = (
        worker.noQueue ||
        gatheringAndNotMining ||
        worker.orders.findIndex(order => order.targetWorldSpacePos && (distance(order.targetWorldSpacePos, position) < 1)) > -1
      );
      return isNotDuplicate && available;
    }));
    const movingOrConstructingNonDronesTimeToPosition = movingOrConstructingNonDrones.map(movingOrConstructingNonDrone => {
      const { orders, pos, unitType } = movingOrConstructingNonDrone; if (orders === undefined || pos === undefined || unitType === undefined) return;
      const { abilityId, targetWorldSpacePos } = orders[0]; if (abilityId === undefined || targetWorldSpacePos === undefined) return;
      const movingPosition = targetWorldSpacePos;
      const movementSpeed = getMovementSpeed(movingOrConstructingNonDrone); if (movingPosition === undefined || movementSpeed === undefined) return;
      const movementSpeedPerSecond = movementSpeed * 1.4;
      const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
      const movingProbeTimeToMovePosition = getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeedPerSecond;
      let buildTimeLeft = 0;
      let supplyDepotCells = [];
      const isSCV = unitType === SCV;
      if (isSCV) {
        buildTimeLeft = getContructionTimeLeft(units, movingOrConstructingNonDrone);
        // if SCV is constructing a SUPPLY_DEPOT, set footprint as pathable premoving position
        dataService.unitTypeTrainingAbilities.get(abilityId)
        const isConstructingSupplyDepot = dataService.unitTypeTrainingAbilities.get(abilityId) === SUPPLYDEPOT;
        if (isConstructingSupplyDepot) {
          const [supplyDepot] = units.getClosest(targetWorldSpacePos, units.getStructures().filter(structure => structure.unitType === SUPPLYDEPOT)); if (supplyDepot === undefined) return;
          const { pos, unitType } = supplyDepot; if (pos === undefined || unitType === undefined) return;
          const footprint = getFootprint(unitType); if (footprint === undefined) return;
          supplyDepotCells = cellsInFootprint(pos, footprint);
          supplyDepotCells.forEach(cell => map.setPathable(cell, true));
        }
      }
      const pathablePremovingPosition = getClosestUnitPositionByPath(resources, position, pathableMovingPosition);
      const targetTimeToPremovePosition = getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeedPerSecond;
      // set pathable back to false
      if (isSCV) {
        supplyDepotCells.forEach(cell => map.setPathable(cell, false));
      }
      return { unit: movingOrConstructingNonDrone, timeToPosition: movingProbeTimeToMovePosition + targetTimeToPremovePosition + buildTimeLeft };
    });
    const candidateWorkersTimeToPosition = []
    const [movingOrConstructingNonDrone] = movingOrConstructingNonDronesTimeToPosition.sort((a, b) => {
      if (a === undefined || b === undefined) return 0;
      return a.timeToPosition - b.timeToPosition;
    });
    if (movingOrConstructingNonDrone !== undefined) {
      candidateWorkersTimeToPosition.push(movingOrConstructingNonDrone);
    }
    const [closestBuilder] = getClosestUnitByPath(resources, position, builderCandidates);
    if (closestBuilder !== undefined) {
      const { pos } = closestBuilder;
      if (pos === undefined) return;
      const movementSpeed = getMovementSpeed(closestBuilder); if (movementSpeed === undefined) return;
      const movementSpeedPerSecond = movementSpeed * 1.4;
      const closestPathablePositionsBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, position);
      const closestBuilderWithDistance = {
        unit: closestBuilder,
        timeToPosition: closestPathablePositionsBetweenPositions.distance / movementSpeedPerSecond
      };
      candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
    }
    const constructingWorkers = units.getConstructingWorkers();
    // calculate build time left plus distance to position by path
    const [closestConstructingWorker] = constructingWorkers.map(worker => {
      // get unit type of building in construction
      const constructingOrder = worker.orders.find(order => constructionAbilities.includes(order.abilityId));
      const unitType = dataService.unitTypeTrainingAbilities.get(constructingOrder.abilityId);
      const { buildTime } = data.getUnitTypeData(unitType);
      // get closest unit type to worker position if within unit type radius
      const closestUnitType = units.getClosest(worker.pos, units.getById(unitType)).filter(unit => distance(unit.pos, worker.pos) < 3)[0];
      let timeToPosition = Infinity;
      if (closestUnitType) {
        const { buildProgress } = closestUnitType;
        const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
        const distanceToPositionByPath = getDistanceByPath(resources, worker.pos, position);
        const { movementSpeed } = worker.data(); if (movementSpeed === undefined) return;
        const movementSpeedPerSecond = movementSpeed * 1.4;
        timeToPosition = buildTimeLeft + (distanceToPositionByPath / movementSpeedPerSecond);
      }
      return {
        unit: worker,
        timeToPosition
      };
    }).sort((a, b) => a.timeToPosition - b.timeToPosition);
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
   * @param {World} world
   * @returns {Point2D[]}
   */
  getCurrentlyEnrouteConstructionGrids: (world) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const contructionGrids = [];
    units.getWorkers().forEach(worker => {
      if (worker.isConstructing() || isPendingContructing(worker)) {
        const orders = [...worker.orders, ...worker['pendingOrders']];
        const foundOrder = orders.find(order => constructionAbilities.includes(order.abilityId));
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
    const { data, resources } = world;
    return enemyUnits.filter(enemyUnit => {
      if (canAttack(resources, enemyUnit, unit) && inCombatRange(data, enemyUnit, unit)) {
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
    let dPSHealth = 0;
    // if unit.unitType is an ADEPTPHASESHIFT, use values of ADEPT assigned to it
    let { alliance, buffIds, health, buildProgress, shield, unitType } = unit;
    if (alliance === undefined || buffIds === undefined || health === undefined || buildProgress === undefined || shield === undefined || unitType === undefined) return 0;
    unitType = unitType !== UnitType.ADEPTPHASESHIFT ? unitType : ADEPT;
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
    let dPSHealth = 0;
    const unitTypeData = getUnitTypeData(units, unitType);
    if (unitTypeData) {
      const { healthMax, shieldMax } = unitTypeData;
      dPSHealth = worldService.getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * (healthMax + shieldMax);
      dPSHealth = unitType === UnitType.ZERGLING ? dPSHealth * 2 : dPSHealth;
    }
    return dPSHealth;
  },
  /**
   * @param {World} world
   * @returns {number}
   */
  getFoodDifference: (world) => {
    const { agent, data, resources } = world;
    const { race } = agent;
    const { units } = resources.get();
    const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return 0; }
    let { plan, legacyPlan } = planService;
    const { addEarmark, getFoodUsed } = worldService;
    const foodUsed = getFoodUsed();
    const step = plan.find(step => step.food > foodUsed);
    const legacyPlanStep = legacyPlan.find(step => step[0] > foodUsed);
    const foodDifference = ((step && step.food) || (legacyPlanStep && legacyPlanStep[0])) - getFoodUsed();
    const productionUnitsCount = units.getProductionUnits(WorkerRace[race]).filter(unit => unit.isIdle() && getPendingOrders(unit).length === 0).length;
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
    return planService.plan.find(step => {
      return (
        step.unitType === unitType &&
        step.targetCount === worldService.getUnitTypeCount(world, unitType) + (unitType === DRONE ? units.getStructures().length - 1 : 0)
      );
    });
  },
  /**
   * @param {World} world
   * @param {Point2D} position
   * @returns {boolean}
   */
  isStrongerAtPosition: (world, position) => {
    const { resources } = world;
    const { units } = resources.get();
    const { calculateNearDPSHealth } = worldService;
    let enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => unit.pos && distance(unit.pos, position) < 16);
    enemyUnits = enemyUnits.length === 1 && enemyUnits[0].unitType && workerTypes.includes(enemyUnits[0].unitType) ? [] : enemyUnits;
    if (enemyUnits.length === 0) return true;
    const selfUnits = units.getAlive(Alliance.SELF).filter(unit => unit.pos && distance(unit.pos, position) < 16);
    const enemyUnitTypes = enemyUnits.reduce((/** @type {UnitTypeId[]} */ accumulator, unit) => {
      const { unitType } = unit;
      if (unitType === undefined) { return accumulator }
      return [...accumulator, unitType];
    }, []);
    const selfDPSHealth = calculateNearDPSHealth(world, selfUnits, enemyUnitTypes);
    const selfUnitTypes = selfUnits.reduce((/** @type {UnitTypeId[]} */ accumulator, unit) => {
      const { unitType } = unit;
      if (unitType === undefined) { return accumulator }
      return [...accumulator, unitType];
    }, []);
    const enemyDPSHealth = calculateNearDPSHealth(world, enemyUnits, selfUnitTypes);
    return selfDPSHealth >= enemyDPSHealth;
  }, 
  /**
   * @param {DataStorage} data 
   * @returns {AbilityId[]}
   */
  getReactorAbilities: (data) => {
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
    const { data, resources } = world;
    const { units } = resources.get();
    let { abilityId } = data.getUnitTypeData(unitTypeId);
    let productionUnits = units.getProductionUnits(unitTypeId).filter(unit => {
      const { orders } = unit;
      const pendingOrders = getPendingOrders(unit);
      if (abilityId === undefined || orders === undefined || pendingOrders === undefined) return false;
      const allOrders = [...orders, ...pendingOrders];
      const spaceToTrain = unit.isIdle() || (unit.hasReactor() && allOrders.length < 2);
      return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition')
    });
    if (productionUnits.length === 0) {
      abilityId = WarpUnitAbility[unitTypeId];
      productionUnits = units.getById(WARPGATE).filter(warpgate => abilityId && warpgate.abilityAvailable(abilityId));
    }
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
    const { data, resources } = world;
    const { units } = resources.get();
    const { calculateSplashDamage } = unitResourceService;
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
   * @param {UnitResource} units
   * @param {AbilityId[]} abilityIds
   * @returns {Unit[]}
   */
  getUnitsWithCurrentOrders: (units, abilityIds) => {
    const unitsWithCurrentOrders = [];
    abilityIds.forEach(abilityId => {
      unitsWithCurrentOrders.push(...units.withCurrentOrders(abilityId));
    });
    return unitsWithCurrentOrders;
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {number}
   */
  getUnitCount: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
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
      let unitsToCount = units.getById(type);
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
   */
  getZergEarlyBuild(world) {
    const { data, resources } = world;
    const { frame, map, units } = resources.get();
    const zerglings = enemyTrackingService.mappedEnemyUnits.filter(unit => unit.unitType === UnitType.ZERGLING);
    const spawningPool = units.getById(SPAWNINGPOOL, { alliance: Alliance.ENEMY }).sort((a, b) => b.buildProgress - a.buildProgress)[0];
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
    const bothStructuresExist = spawningPoolExists && enemyNaturalHatchery;
    const spawningPoolBeforeEnemyNatural = bothStructuresExist && spawningPoolStartTime < enemyNaturalHatcheryStartTime;
    const naturalCommandCenterBeforeEnemyNatural = naturalCommandCenter && enemyNaturalHatchery && naturalCommandCenterStartTime < enemyNaturalHatcheryStartTime;
    const { lastSeen } = scoutService;
    // if spawningPoolStartTime is less than lastSeen['enemyNaturalTownhallFootprint'] with no enemy natural, then we can assume we can set earlyScout to false and enemyBuildType to 'cheese'
    if (spawningPoolStartTime && spawningPoolStartTime < lastSeen['enemyNaturalTownhallFootprint'] && !enemyNaturalHatchery) {
      scoutingService.earlyScout = false;
      scoutingService.enemyBuildType = 'cheese';
      scoutingService.scoutReport = 'Early scout set to false because Spawning Pool start time is less than time enemy natural position was last seen and no enemy natural was found';
      return;
    } else if (spawningPoolBeforeEnemyNatural) {
      scoutingService.enemyBuildType = 'standard';
      scoutingService.scoutReport = `Early scout cancelled: ${spawningPoolBeforeEnemyNatural ? 'spawning pool' : 'natural command center'} before enemy natural`;
      if (bothStructuresExist) {
        scoutingService.earlyScout = false;
      }
      return;
    } else if (naturalCommandCenterBeforeEnemyNatural) {
      scoutingService.enemyBuildType = 'cheese';
      scoutingService.scoutReport = `Early scout cancelled: ${naturalCommandCenterBeforeEnemyNatural ? 'natural command center' : 'natural hatchery'} before enemy natural`;
      if (naturalCommandCenter && enemyNaturalHatchery) {
        scoutingService.earlyScout = false;
      }
      return;
    }
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
      agent.canAfford(supplyUnitId), // can afford to build a pylon
    ];
    return conditions.every(c => c);
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitType
   * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
   */
  morphStructureAction: async (world, unitType) => {
    const { data } = world;
    const collectedActions = [];
    const { addEarmark, ability, unpauseAndLog} = worldService;
    const actions = await ability(world, data.getUnitTypeData(unitType).abilityId);
    if (actions.length > 0) {
      unpauseAndLog(world, UnitTypeId[unitType]);
      addEarmark(data, data.getUnitTypeData(unitType));
      collectedActions.push(...actions);
    }
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
    const { getClosestUnitByPath } = resourceManagerService;
    const { pos } = targetUnit; if (pos === undefined) return false;
    const { isRepairing } = unitResourceService;
    const selfDPSHealth = targetUnit['selfDPSHealth'] || 0;
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy', 'builder']) && !isRepairing(unit));
    const potentialFightersByDistance = getClosestUnitByPath(resources, pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), workers.length);
    const fighters = [];
    let dpsHealth = 0;
    for (let i = 0; i < potentialFightersByDistance.length; i++) {
      const fighter = potentialFightersByDistance[i];
      const fighterDPSHealth = worldService.getDPSHealth(world, fighter, targetUnit['selfUnits'].map((/** @type {Unit} */ unit) => unit.unitType));
      fighters.push(fighter);
      if (dpsHealth + fighterDPSHealth >= selfDPSHealth) break;
      dpsHealth += fighterDPSHealth;
    }
    return fighters.some(fighter => fighter.tag === worker.tag);
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
    const { data, resources } = world;
    const { getClosestUnitByPath } = resourceManagerService;
    const collectedActions = [];
    const { pos, radius, unitType, weaponCooldown } = unit; if (pos === undefined || radius === undefined || unitType === undefined || weaponCooldown === undefined) { return collectedActions; }
    const enemyUnits = enemyTrackingService.mappedEnemyUnits;
    const closestEnemyThatCanAttackUnitByWeaponRange = enemyUnits.reduce((/** @type {{ distance: number, enemyUnit: Unit | undefined }} */ acc, enemyUnit) => {
      const { pos: enemyUnitPos, radius: enemyUnitRadius, unitType: enemyUnitType } = enemyUnit; if (enemyUnitPos === undefined || enemyUnitRadius === undefined || enemyUnitType === undefined) { return acc; }
      const weaponThatCanAttack = getWeaponThatCanAttack(data, enemyUnitType, unit); if (weaponThatCanAttack === undefined) { return acc; }
      const { range } = weaponThatCanAttack; if (range === undefined) { return acc; }
      const distanceBetweenUnitAndEnemyUnit = getDistance(pos, enemyUnitPos) - radius - enemyUnitRadius - range;
      if (distanceBetweenUnitAndEnemyUnit < acc.distance) {
        return { distance: distanceBetweenUnitAndEnemyUnit, enemyUnit };
      }
      return acc;
    }, { distance: Infinity, enemyUnit: undefined });
    const { enemyUnit } = closestEnemyThatCanAttackUnitByWeaponRange;
    if (weaponCooldown > 8 && enemyUnit !== undefined) {
      const unitCommand = createUnitCommand(MOVE, [unit]);
      const travelDistancePerStep = 2 * getTravelDistancePerStep(unit);
      unitCommand.targetWorldSpacePos = worldService.findClosestSafePosition(world, unit, travelDistancePerStep);
      collectedActions.push(unitCommand);
    } else {
      const inRangeAttackableEnemyUnits = enemyUnits.filter(enemyUnit => {
        const { pos: enemyUnitPos, radius: enemyUnitRadius } = enemyUnit; if (enemyUnitPos === undefined || enemyUnitRadius === undefined) { return false; }
        const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, enemyUnit); if (weaponThatCanAttack === undefined) { return false; }
        const { range } = weaponThatCanAttack; if (range === undefined) { return false; }
        return getDistance(pos, enemyUnitPos) <= range + radius + enemyUnitRadius;
      });
      if (inRangeAttackableEnemyUnits.length === 0) {
        const [closestAttackableEnemyUnit] = getClosestUnitByPath(resources, pos, enemyUnits.filter(enemyUnit => canAttack(resources, unit, enemyUnit)));
        if (closestAttackableEnemyUnit !== undefined) {
          const { pos: closestAttackableEnemyUnitPos } = closestAttackableEnemyUnit; if (closestAttackableEnemyUnitPos === undefined) { return collectedActions; }
          const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
          if (closestAttackableEnemyUnit.isCurrent()) {
            unitCommand.targetUnitTag = closestAttackableEnemyUnit.tag;
          } else {
            unitCommand.targetWorldSpacePos = closestAttackableEnemyUnitPos;
          }
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
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  microRangedUnit: (world, unit, targetUnit) => {
    const { data } = world;
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    const { radius, tag, unitType, weaponCooldown } = unit;
    if (radius === undefined || tag === undefined || unitType === undefined || weaponCooldown === undefined) return collectedActions;
    const weaponCooldownOverStepSize = weaponCooldown > 8;
    const enemyWeapon = getWeapon(data, targetUnit, unit);
    if ((weaponCooldownOverStepSize || unit.unitType === UnitType.CYCLONE) && enemyWeapon) {
      const microPosition = worldService.getPositionVersusTargetUnit(world, unit, targetUnit);
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: microPosition,
        unitTags: [tag],
      });
    } else {
      const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
      const enemyUnitsInRange = [];
      const { weapons } = unit.data();
      if (weapons === undefined) return collectedActions;
      weapons.forEach(weapon => {
        const { range } = weapon;
        if (range === undefined || targetUnit.radius === undefined) return;
        const weaponRange = range + radius + targetUnit.radius;
        if (weapon.type === WeaponTargetType.ANY) {
          enemyUnitsInRange.push(...getInRangeUnits(unit, [...enemyTrackingService.mappedEnemyUnits], weaponRange));
          return;
        }
        if (weapon.type === WeaponTargetType.GROUND) {
          const groundEnemyUnits = enemyTrackingService.mappedEnemyUnits.filter(unit => !unit.isFlying);
          enemyUnitsInRange.push(...getInRangeUnits(unit, groundEnemyUnits, weaponRange));
          return;
        }
        if (weapon.type === WeaponTargetType.AIR) {
          const airEnemyUnits = enemyTrackingService.mappedEnemyUnits.filter(unit => unit.isFlying);
          enemyUnitsInRange.push(...getInRangeUnits(unit, airEnemyUnits, weaponRange));
          return;
        }
      });
      if (enemyUnitsInRange.length > 0) {
        const weakestEnemyUnitInRange = enemyUnitsInRange.reduce((weakest, enemyUnit) => {
          if (weakest === undefined) return enemyUnit;
          return weakest.health < enemyUnit.health ? weakest : enemyUnit;
        }, undefined);
        if (weakestEnemyUnitInRange) {
          unitCommand.targetUnitTag = weakestEnemyUnitInRange.tag;
        }
      } else {
        unitCommand.targetWorldSpacePos = targetUnit.pos;
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  premoveBuilderToPosition: (world, position, unitType) => {
    const { agent, data, resources } = world;
    if (earmarkThresholdReached(data)) return [];
    const { debug, map, units } = resources.get();
    const { getClosestPathablePositionsBetweenPositions, getClosestPositionByPath, getClosestUnitByPath, getDistanceByPath } = resourceManagerService;
    const { setPendingOrders, getOrderTargetPosition } = unitResourceService;
    const { rallyWorkerToTarget } = worldService;
    const collectedActions = [];
    position = getMiddleOfStructure(position, unitType);
    const builder = worldService.getBuilder(world, position);
    if (builder) {
      let { unit, timeToPosition } = builder;
      // get speed, distance and average collection rate
      const { movementSpeed } = unit.data(); if (movementSpeed === undefined) return collectedActions;
      const movementSpeedPerSecond = movementSpeed * 1.4;
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
          let baseTimeToPosition = (baseDistanceToPosition / movementSpeedPerSecond) + getTimeInSeconds(buildTimeLeft) + movementSpeedPerSecond;
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
          collectedActions.push(...rallyWorkerToTarget(world, position));
          collectedActions.push(...stopUnitFromMovingToPosition(unit, position));
        } else {
          const movingButNotToPosition = isMoving(unit) && getOrderTargetPosition(units, unit) !== position;
          if (!unit.isConstructing() && !movingButNotToPosition) {
            unitCommand.targetWorldSpacePos = position;
            setBuilderLabel(unit);
            collectedActions.push(unitCommand, ...unitResourceService.stopOverlappingBuilders(units, unit, position));
            setPendingOrders(unit, unitCommand);
            if (agent.race === Race.ZERG) {
              const { foodRequired } = data.getUnitTypeData(unitType);
              if (foodRequired === undefined) return collectedActions;
              planService.pendingFood -= foodRequired;
            }
          }
          collectedActions.push(...rallyWorkerToTarget(world, position, true));
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
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const { isRepairing } = unitResourceService;
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
        collectedActions.push(...micro(units, worker, targetUnit, enemyUnits));
      }
    } else if (worker.isAttacking() && worker.orders.find(order => order.abilityId === ATTACK_ATTACK).targetUnitTag === targetUnit.tag) {
      collectedActions.push(...gatherOrMine(resources, worker));
    }
    return collectedActions;
  },
  /**
 * @param {World} world 
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
  rallyWorkerToTarget: (world, position, mineralTarget = false) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const { getNeediestMineralField } = unitResourceService;
    const collectedActions = [];
    const workerSourceByPath = worldService.getWorkerSourceByPath(world, position);
    let rallyAbility = null;
    if (workerSourceByPath) {
      const { orders, pos } = workerSourceByPath;
      if (pos === undefined) return collectedActions;
      if (workerSourceByPath.unitType === EGG) {
        rallyAbility = orders.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? RALLY_BUILDING : null;
      } else {
        rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
      }
      if (rallyAbility) {
        const unitCommand = createUnitCommand(rallyAbility, [workerSourceByPath]);
        if (mineralTarget) {
          const [closestExpansion] = getClosestExpansion(map, pos);
          const { mineralFields } = closestExpansion.cluster;
          const neediestMineralField = getNeediestMineralField(units, mineralFields);
          if (neediestMineralField === undefined) return collectedActions;
          unitCommand.targetUnitTag = neediestMineralField.tag;
        } else {
          unitCommand.targetWorldSpacePos = position;
        }
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  repositionBuilding: (world) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const { setPendingOrders } = unitResourceService;
    const repositionUnits = units.withLabel('reposition');
    const collectedActions = [];
    if (repositionUnits.length > 0) {
      repositionUnits.forEach(unit => {
        const { orders, pos } = unit;
        if (orders === undefined || pos === undefined) return;
        if (unit.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !unit.labels.has('pendingOrders')) {
          if (unit.labels.get('reposition') === 'lift') {
            const unitCommand = createUnitCommand(Ability.LIFT, [unit]);
            collectedActions.push(unitCommand);
            setPendingOrders(unit, unitCommand);
          } else {
            if (distance(pos, unit.labels.get('reposition')) > 1) {
              const unitCommand = createUnitCommand(Ability.LIFT, [unit]);
              collectedActions.push(unitCommand);
              setPendingOrders(unit, unitCommand);
            } else {
              unit.labels.delete('reposition');
              const { addOnTag } = unit; if (addOnTag === undefined) return collectedActions;
              const addOn = units.getByTag(addOnTag); if (!addOn) return collectedActions;
              addOn.labels.delete('reposition');
            }
          }
        }
        if (unit.availableAbilities().find(ability => landingAbilities.includes(ability))) {
          if (unit.labels.get('reposition') === 'lift') {
            unit.labels.delete('reposition');
            const { addOnTag } = unit; if (addOnTag === undefined) return collectedActions;
            const addOn = units.getByTag(addOnTag); if (!addOn) return collectedActions;
            if (addOn.labels) {
              addOn.labels.delete('reposition');
            }
          } else {
            const unitCommand = createUnitCommand(Ability.LAND, [unit]);
            unitCommand.targetWorldSpacePos = unit.labels.get('reposition');
            collectedActions.push(unitCommand);
            planService.pausePlan = false;
            setPendingOrders(unit, unitCommand);
          }
        }
        // cancel training orders
        if (dataService.isTrainingUnit(data, unit)) {
          orders.forEach(() => {
            collectedActions.push(createUnitCommand(CANCEL_QUEUE5, [unit]));
          });
        }
      });
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @returns {Point2D|undefined}
   */
  retreat: (world, unit, targetUnit, toCombatRally = true) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const { getClosestPositionByPath, getCombatRally, getDistanceByPath } = resourceManagerService;
    const { pos } = unit;
    if (pos === undefined) return;
    const { findClosestSafePosition } = worldService;
    const closestSafePosition = findClosestSafePosition(world, unit);
    const travelDistancePerStep = 2 * getTravelDistancePerStep(unit);
    if (closestSafePosition) {
      if (distance(pos, closestSafePosition) < travelDistancePerStep) {
        const closestBunkerPositionByPath = units.getById(UnitType.BUNKER)
          .filter((unit) => unit.buildProgress === 1)
          .map((unit) => unit.pos)
          .sort((a, b) => getDistanceByPath(resources, a, unit.pos) - getDistanceByPath(resources, b, unit.pos))[0];
        // get closest position to unit by path
        const combatRally = getCombatRally(resources);
        let combatRallyCloser = true;
        if (closestBunkerPositionByPath) {
          combatRallyCloser = getDistanceByPath(resources, combatRally, unit.pos) < getDistanceByPath(resources, closestBunkerPositionByPath, unit.pos);
        }
        const unitToCombatRallyDistance = getDistanceByPath(resources, pos, combatRally);
        const targetUnitToCombatRallyDistance = getDistanceByPath(resources, targetUnit.pos, combatRally);
        if (
          toCombatRally &&
          combatRallyCloser &&
          unitToCombatRallyDistance > 16 && unitToCombatRallyDistance !== Infinity &&
          unitToCombatRallyDistance <= targetUnitToCombatRallyDistance
        ) {
          return combatRally;
        } else if (closestBunkerPositionByPath) {
          return closestBunkerPositionByPath;
        } else {
          const retreatCandidates = getRetreatCandidates(world, unit, targetUnit);
          const [largestPathDifferenceRetreat] = retreatCandidates.map((retreat) => {
            if (retreat === undefined) return;
            const { point } = retreat;
            const [closestPathablePosition] = getClosestPositionByPath(resources, pos, getPathablePositions(map, point));
            return {
              point,
              distanceByPath: getDistanceByPath(resources, pos, closestPathablePosition),
            }
          }).sort((a, b) => {
            const [closestPathablePositionA] = getClosestPositionByPath(resources, pos, getPathablePositions(map, a));
            const [closestPathablePositionB] = getClosestPositionByPath(resources, pos, getPathablePositions(map, b));
            return getDistanceByPath(resources, pos, closestPathablePositionA) - getDistanceByPath(resources, pos, closestPathablePositionB);
          });
          if (largestPathDifferenceRetreat) {
            return largestPathDifferenceRetreat.point;
          } else {
            return findClosestSafePosition(world, unit, travelDistancePerStep) || moveAwayPosition(targetUnit.pos, unit.pos, travelDistancePerStep);
          }
        }
      } else {
        return closestSafePosition;
      }
    } else {
      return moveAwayPosition(targetUnit.pos, unit.pos, travelDistancePerStep);
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
    const { foodUsed, minerals, vespene } = agent;
    let isStructure = false;
    if (UnitType[name]) {
      const { attributes } = data.getUnitTypeData(UnitType[name]); if (attributes === undefined) return;
      isStructure = attributes.includes(Attribute.STRUCTURE);
    }
    // set foodCount to foodUsed plus 1 if it's a structure and race is zerg
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
    units.forEach(unit => {
      unit['enemyUnits'] = setUnitsProperty(unit, enemyUnits);
      const [closestEnemyUnit] = resources.get().units.getClosest(unit.pos, enemyUnits).filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['enemyDPSHealth'] = worldService.calculateNearDPSHealth(world, unit['enemyUnits'], (closestEnemyUnit && closestEnemyUnit['selfUnits']) ? closestEnemyUnit['selfUnits'].map((/** @type {{ unitType: any; }} */ selfUnit) => selfUnit.unitType) : []);
    });
  },
  /**
   * @param {World} world
   */
  setFoodUsed: (world) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const { foodUsed, race } = agent; if (foodUsed === undefined) { return 0; }
    const pendingFoodUsed = race === Race.ZERG ? getWorkers(units).filter(worker => worker.isConstructing()).length : 0;
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
    units.forEach(unit => {
      unit['selfUnits'] = setUnitsProperty(unit, units);
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
   * @param {World} world 
   * @param {[]} conditions 
   */
  swapBuildings: async (world, conditions = []) => {
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
   * @param {UnitTypeId} unitTypeId 
   * @param {number | null} targetCount
   * @returns {Promise<void>}
   */
  train: async (world, unitTypeId, targetCount = null) => {
    const { data, resources } = world;
    const { actions, units } = resources.get();
    const { addEarmark, canBuild, getTrainer, unpauseAndLog } = worldService;
    const { warpIn } = resourceManagerService;
    const { setPendingOrders } = unitResourceService;
    let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return;
    if (checkUnitCount(world, unitTypeId, targetCount) || targetCount === null) {
      const randomTrainer = getRandom(getTrainer(world, unitTypeId));
      if (canBuild(world, unitTypeId) && randomTrainer) {
        if (randomTrainer.unitType !== WARPGATE) {
          const unitCommand = createUnitCommand(abilityId, [randomTrainer]);
          setPendingOrders(randomTrainer, unitCommand);
          unpauseAndLog(world, UnitTypeId[unitTypeId]);
          await actions.sendAction([unitCommand]);
        } else {
          unpauseAndLog(world, UnitTypeId[unitTypeId]);
          await warpIn(resources, this, unitTypeId);
        }
        addEarmark(data, data.getUnitTypeData(unitTypeId));
        console.log(`Training ${Object.keys(UnitType).find(type => UnitType[type] === unitTypeId)}`);
        unitTrainingService.selectedTypeToBuild = null;
      } else {
        addEarmark(data, data.getUnitTypeData(unitTypeId));
        let canDoTypes = data.findUnitTypesWithAbility(abilityId);
        const canDoUnits = units.getById(canDoTypes);
        const unit = canDoUnits[Math.floor(Math.random() * canDoUnits.length)];
        if (!unit) return;
        const unitCommand = createUnitCommand(abilityId, [unit]);
        setPendingOrders(unit, unitCommand);
      }
    }
  },
  /**
   * @param {World} world 
   * @param {UnitTypeId} unitTypeId 
   * @param {number | null} targetCount
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  trainSync: (world, unitTypeId, targetCount = null) => {
    const { data } = world;
    const collectedActions = [];
    const { addEarmark, canBuild, getTrainer, unpauseAndLog } = worldService;
    const { warpInSync } = resourceManagerService;
    const { setPendingOrders } = unitResourceService;
    let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return collectedActions;
    if (checkUnitCount(world, unitTypeId, targetCount) || targetCount === null) {
      const randomTrainer = getRandom(getTrainer(world, unitTypeId));
      if (randomTrainer) {
        if (canBuild(world, unitTypeId) && randomTrainer) {
          if (randomTrainer.unitType !== WARPGATE) {
            const unitCommand = createUnitCommand(abilityId, [randomTrainer]);
            collectedActions.push(unitCommand);
            setPendingOrders(randomTrainer, unitCommand);
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
    const { agent, resources } = world;
    const { units } = resources.get();
    const { getClosestPathablePositionsBetweenPositions, getDistanceByPath } = resourceManagerService;
    let idealHarvesters = 0
    let assignedHarvesters = 0
    const mineralCollectors = [...units.getBases(), ...units.getById(gasMineTypes)]
    mineralCollectors.forEach(mineralCollector => {
      const { buildProgress, assignedHarvesters: assigned, idealHarvesters: ideal, unitType } = mineralCollector;
      if (buildProgress === undefined || assigned === undefined || ideal === undefined || unitType === undefined) return;
      if (buildProgress === 1) {
        assignedHarvesters += assigned;
        idealHarvesters += ideal;
      } else {
        if (townhallTypes.includes(unitType)) {
          const mineralFields = mineralCollector.labels.get('mineralFields') || units.getMineralFields().filter(mineralField => {
            const { pos } = mineralField; if (pos === undefined) return false;
            const { pos: townhallPos } = mineralCollector; if (townhallPos === undefined) return false;
            if (distance(pos, townhallPos) < 16) {
              const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, townhallPos)
              const { pathablePosition, pathableTargetPosition } = closestPathablePositionBetweenPositions;
              const distanceByPath = getDistanceByPath(resources, pathablePosition, pathableTargetPosition);
              return distanceByPath <= 16;
            } else {
              return false;
            }
          });
          if (!mineralCollector.labels.has('mineralFields')) {
            mineralCollector.labels.set('mineralFields', mineralFields);
          }
          idealHarvesters += mineralFields.length * 2 * buildProgress;
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
        !attributes.includes(Attribute.STRUCTURE) &&
        foodRequired <= food - getFoodUsed() &&
        outpowered ? outpowered : planMin[UnitTypeId[type]] <= getFoodUsed() &&
        !unitMax[UnitTypeId[type]] || (getUnitTypeCount(world, type) < unitMax[UnitTypeId[type]]) &&
        agent.hasTechFor(type) &&
        haveAvailableProductionUnitsFor(world, type)
      ) {
        return true;
      }
    });
    if (candidateTypesToBuild.length > 0) {
      let { selectedTypeToBuild } = unitTrainingService;
      selectedTypeToBuild = selectedTypeToBuild ? selectedTypeToBuild : selectTypeToBuild(world, candidateTypesToBuild);
      if (selectedTypeToBuild !== undefined && selectedTypeToBuild !== null) {
        let { totalMineralCost, totalVespeneCost } = getResourceDemand(world.data, [plan[currentStep] ? plan[currentStep] : convertLegacyStep(legacyPlan[currentStep])] || []);
        let { mineralCost, vespeneCost } = data.getUnitTypeData(selectedTypeToBuild);
        if (selectedTypeToBuild === ZERGLING) {
          totalMineralCost += mineralCost;
          totalVespeneCost += vespeneCost;
        }
        const enoughMinerals = minerals >= (totalMineralCost + mineralCost);
        const enoughVespene = (vespeneCost === 0) || (vespene >= (totalVespeneCost + vespeneCost));
        const freeBuildThreshold = enoughMinerals && enoughVespene;
        if (outpowered || freeBuildThreshold) {
          collectedActions.push(...trainSync(world, selectedTypeToBuild));
        }
      }
      unitTrainingService.selectedTypeToBuild = selectedTypeToBuild;
    }
    return collectedActions;
  },
  /**
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  trainWorkers: (world) => {
    const { agent, data, resources } = world;
    const { minerals } = agent; if (minerals === undefined) return [];
    const { race } = agent;
    const { units } = resources.get();
    const { getFoodDifference } = worldService;
    const collectedActions = [];
    const workerCount = units.getById(WorkerRace[race]).length;
    const assignedWorkerCount = [...units.getBases(), ...units.getById(GasMineRace[race])].reduce((assignedWorkerCount, base) => base.assignedHarvesters + assignedWorkerCount, 0);
    const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
    const { outpowered, unitProductionAvailable, buildWorkers, shortOnWorkers } = worldService
    let conditionsMet = planService.bogIsActive && minimumWorkerCount <= 11;
    let foodDifference = getFoodDifference(world);
    if (!planService.bogIsActive) {
      const conditions = [
        haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]),
        minerals < 512 || minimumWorkerCount <= 36,
        shortOnWorkers(world) || foodDifference > 0,
        !outpowered || (outpowered && !unitProductionAvailable)
      ];
      conditionsMet = conditions.every(condition => condition);
    }
    if (conditionsMet) {
      unitTrainingService.workersTrainingTendedTo = false;
      const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return []; }
      const productionUnit = resources.get().units.getProductionUnits(WorkerRace[race]).find(u => u.noQueue && u.abilityAvailable(abilityId));
      try {
        if (productionUnit) collectedActions.push(...buildWorkers(world, foodDifference, true));
      } catch (error) { console.log(error); }
    } else {
      unitTrainingService.workersTrainingTendedTo = true;
    }
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
    const foodUsed = getFoodUsed() + getEarmarkedFood();
    const foodUsedLessThanNextStepFoodTarget = step && foodUsed < step.food;
    if (!step || foodUsedLessThanNextStepFoodTarget) {
      await buildSupply(world);
      let trainingOrders = trainWorkers(world);
      trainingOrders = trainingOrders.length > 0 ? trainingOrders : trainCombatUnits(world);
      if (trainingOrders.length > 0) {
        await actions.sendAction(trainingOrders);
      } else {
        // get food difference
        const foodUsed = getFoodUsed() + getEarmarkedFood();
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
    planService.pausePlan = false;
    planService.continueBuild = true;
    if (!(WorkerRace[agent.race] === UnitType[name])) {
      worldService.setAndLogExecutedSteps(world, frame.timeInSeconds(), name, extra);
    }
  },
  /**
   * @param {World} world
   * @param {Point2D} position
   */
  getWorkerSourceByPath: (world, position) => {
    const { agent, resources } = world;
    const { units } = resources.get();
    const { getClosestUnitByPath } = resourceManagerService;
    // worker source is base or larva.
    let closestUnitByPath = null;
    if (agent.race === Race.ZERG) {
      [closestUnitByPath] = getClosestUnitByPath(resources, position, units.getById(EGG));
    } else {
      [closestUnitByPath] = getClosestUnitByPath(resources, position, units.getBases());
    }
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
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const willHaveEnoughMineralsByArrival = timeToTargetCost <= timeToPosition;
  // if race is protoss
  if (agent.race === Race.PROTOSS) {
    const pylons = units.getById(UnitType.PYLON);
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
 * @param {ResourceManager} resources 
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function findZergPlacements(resources, unitType) {
  const { map, units } = resources.get();
  // get all mineral line points
  const mineralLinePoints = map.getExpansions().reduce((mineralLines, expansion) => {
    const { mineralLine } = expansion.areas;
    return [...mineralLines, ...mineralLine];
  }, []);
  const candidatePositions = [];
  if (unitType !== UnitType.NYDUSCANAL) {
    // get all points with creep within 12.5 distance of ally structure
    const creepCandidates = map.getCreep().filter((point) => {
      const [closestMineralLine] = getClosestPosition(point, mineralLinePoints);
      const [closestStructure] = units.getClosest(point, units.getStructures());
      return (
        distance(point, closestMineralLine) > 1.5 &&
        distance(point, closestStructure.pos) > 3 &&
        distance(point, closestStructure.pos) <= 12.5
      );
    });
    candidatePositions.push(...creepCandidates);
  } else {
    // get all points in vision
    const visionPoints = map.getVisibility().filter((point) => {
      const [closestMineralLine] = getClosestPosition(point, mineralLinePoints);
      const [closestStructure] = units.getClosest(point, units.getStructures());
      return (
        distance(point, closestMineralLine) > 1.5 &&
        distance(point, closestStructure.pos) > 3
      );
    });
    candidatePositions.push(...visionPoints);
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
 * @param {number} radius
 * @returns {Point2D[]}
 **/
function getSafePositions(world, unit, radius = 1) {
  const { data, resources } = world;
  const { map } = resources.get();
  let safePositions = [];
  const { pos } = unit;
  if (pos === undefined || radius === undefined) return safePositions;
  const { mappedEnemyUnits } = enemyTrackingService;
  const enemyUnits = mappedEnemyUnits.filter(enemyUnit => enemyUnit.pos && distance(pos, enemyUnit.pos) <= 16);
  while (safePositions.length === 0 && radius <= 16) {
    for (let i = 0; i < 360; i += 5) {
      const angle = i * Math.PI / 180;
      const { x, y } = pos; if (x === undefined || y === undefined) return safePositions;
      const point = {
        x: x + radius * Math.cos(angle),
        y: y + radius * Math.sin(angle),
      };
      if (existsInMap(map, point) && map.isPathable(point)) {
        const fartherThanEnemyUnits = enemyUnits.every(enemyUnit => enemyUnit.pos && (distance(point, enemyUnit.pos) > distance(point, pos)))
        if (fartherThanEnemyUnits) {
          const pointWithHeight = { ...point, z: map.getHeight(point) };
          const safePositionFromTargets = isSafePositionFromTargets(map, unit, enemyUnits, pointWithHeight);
          if (safePositionFromTargets) {
            safePositions.push(point);
          }
        }
      }
    }
    radius += 1;
  }
  return safePositions.sort((b, a) => getUnitWeaponDistanceToPosition(data, a, unit, enemyUnits) - getUnitWeaponDistanceToPosition(data, b, unit, enemyUnits));
}
/**
 * @param {MapResource} map
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits
 * @param {Point3D} point 
 * @returns {boolean}
 */
function isSafePositionFromTargets(map, unit, targetUnits, point) {
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
    const safeDistance = (weaponRange + radius + targetUnit.radius + getTravelDistancePerStep(targetUnit) + getTravelDistancePerStep(unit));
    return distanceToTarget > safeDistance;
  });
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {(import("../interfaces/retreat-candidate").RetreatCandidate | undefined)[]}
*/
function getRetreatCandidates(world, unit, targetUnit) {
  const { resources } = world;
  const { map, units } = resources.get();
  const { getClosestUnitByPath, getClosestPositionByPath, getDistanceByPath } = resourceManagerService;
  const { calculateNearDPSHealth } = worldService;
  const expansionLocations = map.getExpansions().map((expansion) => expansion.centroid);
  const { centroid } = map.getMain(); if (centroid === undefined) return [];
  return expansionLocations.map((point) => {
    if (point === undefined) return undefined;
    const damageDealingEnemies = worldService.getDamageDealingUnits(world, unit, targetUnit['selfUnits'] || getEnemyUnits(targetUnit));
    let [closestToRetreat] = getClosestUnitByPath(resources, point, damageDealingEnemies);
    if (closestToRetreat) {
      const closestToRetreatOrTargetUnit = closestToRetreat ? closestToRetreat : targetUnit;
      if (closestToRetreatOrTargetUnit.pos === undefined) return undefined;
      const pathablePositions = getPathablePositions(map, point);
      const [closestToRetreatOrTargetUnitPosition] = getClosestPositionByPath(resources, closestToRetreatOrTargetUnit.pos, pathablePositions);
      const getDistanceByPathToTarget = getDistanceByPath(resources, closestToRetreatOrTargetUnit.pos, closestToRetreatOrTargetUnitPosition);
      const { pos } = unit;
      if (pos === undefined) return undefined;
      const [closestToUnitByPath] = getClosestPositionByPath(resources, pos, pathablePositions);
      const getDistanceByPathToRetreat = getDistanceByPath(resources, pos, closestToUnitByPath);
      if (getDistanceByPathToRetreat === Infinity) return undefined;
      const [closestUnit] = units.getClosest(point, [...trackUnitsService.selfUnits, ...enemyTrackingService.mappedEnemyUnits]);
      const { pos: closestUnitPos } = closestUnit; if (closestUnitPos === undefined) return undefined;
      let safeToRetreat = true;
      if (getDistance(closestUnitPos, point) < 16) {
        const alliesAtPoint = getUnitsInRangeOfPosition(trackUnitsService.selfUnits, point, 16);
        const enemiesNearUnit = getUnitsInRangeOfPosition(enemyTrackingService.mappedEnemyUnits, pos, 16);
        // @ts-ignore
        const dpsHealth = calculateNearDPSHealth(world, alliesAtPoint, enemiesNearUnit.map((enemy) => enemy.unitType));
        // @ts-ignore
        const dpsHealthOfEnemies = calculateNearDPSHealth(world, enemiesNearUnit, alliesAtPoint.map((ally) => ally.unitType));
        safeToRetreat = dpsHealth >= dpsHealthOfEnemies;
      }
      return {
        'point': point,
        getDistanceByPathToRetreat,
        getDistanceByPathToTarget,
        'closerOrEqualThanTarget': getDistanceByPathToRetreat <= getDistanceByPathToTarget,
        'safeToRetreat': safeToRetreat,
      }
    } else {
      return undefined;
    }
  }).filter((/** @type {import("../interfaces/retreat-candidate").RetreatCandidate | undefined} */ candidate) => {
    if (candidate === undefined) return false;
    const { closerOrEqualThanTarget, safeToRetreat } = candidate;
    return closerOrEqualThanTarget && safeToRetreat;
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
  if (unit.unitType === UnitType.ADEPTPHASESHIFT) {
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
 * @param {Unit} unit
 * @param {Unit[]} units
 * @returns {Unit[]}
 */
function setUnitsProperty(unit, units) {
  return units.filter(toFilterUnit => {
    if (unit.pos === undefined || toFilterUnit.pos === undefined || unit.radius === undefined || toFilterUnit.radius === undefined) return false;
    const { weapons } = toFilterUnit.data();
    if (weapons === undefined) return false;
    const weaponRange = weapons.reduce((acc, weapon) => {
      if (weapon.range === undefined) return acc;
      return weapon.range > acc ? weapon.range : acc;
    }, 0);
    
    return distance(unit.pos, toFilterUnit.pos) <= weaponRange + unit.radius + toFilterUnit.radius + getTravelDistancePerStep(toFilterUnit) + getTravelDistancePerStep(unit);
  });
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @param {Unit} targetUnit 
 */
function inCombatRange(data, unit, targetUnit) {
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
  return distance(pos, targetPos) <= range + radius + targetRadius + getTravelDistancePerStep(targetUnit) + getTravelDistancePerStep(unit);
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
  const [techUnit] = units.getById(techRequirement).sort((a, b) => {
    const { buildProgress: buildProgressA } = a;
    const { buildProgress: buildProgressB } = b;
    if (buildProgressA === undefined || buildProgressB === undefined) return 0;
    return buildProgressB - buildProgressA;
  });
  if (techUnit === undefined) return 0;
  const { buildProgress } = techUnit;
  if (buildProgress === undefined) return 0;
  return getTimeInSeconds((1 - buildProgress) * buildTime);
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
 * @param {UnitResource} units
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getContructionTimeLeft(units, unit, inSeconds = true) {
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos } = constructingOrder; if (targetWorldSpacePos === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && dataService.unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && distance(unit.pos, targetWorldSpacePos) < 1);
  if (unitAtTargetPosition !== undefined) {
    const { buildTime } = unitAtTargetPosition.data(); if (buildTime === undefined) return 0;
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
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
  const { agent } = world;
  const { foodUsed, minerals } = agent; if (foodUsed === undefined || minerals === undefined) return;
  const { build, isSupplyNeeded, findPlacements, train } = worldService;
  const greaterThanPlanSupply = foodUsed > planService.planMax.supply;
  const conditions = [
    isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512)
  ];
  if (conditions.some(condition => condition)) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositions = await findPlacements(world, SUPPLYDEPOT);
        await build(world, SUPPLYDEPOT, null, candidatePositions);
        break;
      }
      case Race.PROTOSS: {
        const candidatePositions = await findPlacements(world, PYLON);
        await build(world, PYLON, null, candidatePositions);
        break;
      }
      case Race.ZERG: await train(world, OVERLORD); break;
    }
  }
}

/**
 * @param {UnitResource} units
 * @returns {Unit[]}
 */
function getWorkers(units) {
  return unitResourceService.workers || (unitResourceService.workers = units.getWorkers());
}

