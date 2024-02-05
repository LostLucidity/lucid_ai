//@ts-check
"use strict";

const { Ability, UnitType } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { WorkerRace } = require('@node-sc2/core/constants/race-map');
const { avgPoints } = require('@node-sc2/core/utils/geometry/point');

const { handleNonRallyBase } = require('./buildingWorkerInteractions');
const { logNoFreeGeysers } = require('./sharedConstructionUtils');
const { checkAddOnPlacement } = require('./sharedUnitPlacement');
const { getPendingOrders } = require('./stateManagement');
const GameState = require('../../core/gameState');
const { getTimeToTargetTech } = require('../common/gameData');
const { getClosestUnitByPath, getClosestPositionByPath } = require('../common/pathfinding');
const { getPathCoordinates, getMapPath } = require('../common/pathUtils');
const { calculateBaseTimeToPosition } = require('../common/placementAndConstructionUtils');
const { getAddOnPlacement } = require('../common/placementUtils');
const { getClosestPathWithGasGeysers, getBuildTimeLeft, getUnitsFromClustering } = require('../common/sharedUtils');
const { unitTypeTrainingAbilities, canLiftOff } = require('../common/unitConfig');
const { getDistanceByPath, isPlaceableAtGasGeyser, getPathablePositionsForStructure, createUnitCommand, positionIsEqual } = require('../common/utils');
const { handleRallyBase, getOrderTargetPosition, rallyWorkerToTarget } = require('../common/workerUtils');
const { earmarkThresholdReached } = require('../resourceManagement/resourceUtils');

/**
 * Determines a valid position for placing a building.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Point3D[]} candidatePositions
 * @param {false | Point2D | undefined} buildingPositionFn
 * @param {(world: World, unitType: UnitTypeId) => Point2D[]} findPlacementsFn
 * @param {(world: World, unitType: UnitTypeId, candidatePositions: Point2D[]) => false | Point2D} findPositionFn
 * @param {(unitType: UnitTypeId, position: false | Point2D) => void} setBuildingPositionFn
 * @returns {false | Point2D}
 */
function determineBuildingPosition(world, unitType, candidatePositions, buildingPositionFn, findPlacementsFn, findPositionFn, setBuildingPositionFn) {
  if (buildingPositionFn && keepPosition(world, unitType, buildingPositionFn, isPlaceableAtGasGeyser)) {
    setBuildingPositionFn(unitType, buildingPositionFn);
    return buildingPositionFn;
  }

  if (isGasCollector(unitType)) {
    candidatePositions = findPlacementsFn(world, unitType).filter(pos => isGeyserFree(world, pos));
    if (candidatePositions.length === 0) {
      logNoFreeGeysers();
      return false;
    }
  } else if (candidatePositions.length === 0) {
    candidatePositions = findPlacementsFn(world, unitType);
  }

  let position = findPositionFn(world, unitType, candidatePositions);
  if (!position) {
    console.error(`No valid position found for building type ${unitType}`);
    return false;
  }

  setBuildingPositionFn(unitType, position);
  return position;
}

/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} logCondition
 * @returns {Point2D | undefined}
 */
function findBestPositionForAddOn(world, unit, logCondition = false) {
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
 * Retrieves detailed information about a builder unit.
 * @param {{unit: Unit, timeToPosition: number}} builder The builder object with unit and time to position.
 * @returns {{unit: Unit, timeToPosition: number, movementSpeedPerSecond: number}} Information about the builder.
 */
function getBuilderInformation(builder) {
  let { unit, timeToPosition } = builder;
  const { movementSpeed } = unit.data();
  const movementSpeedPerSecond = movementSpeed ? movementSpeed * 1.4 : 0;
  return { unit, timeToPosition, movementSpeedPerSecond };
}

/**
 * Find potential building placements within the main base.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function getInTheMain(world, unitType) {
  const { map } = world.resources.get();
  const mainBase = map.getMain();

  if (!mainBase || !mainBase.areas) {
    return []; // Return an empty array if mainBase or its areas are undefined
  }

  // Filter the placement grid to find suitable positions
  return mainBase.areas.placementGrid.filter(grid => map.isPlaceableAt(unitType, grid));
}

/**
 * Checks if a unit has an add-on.
 * @param {Unit} unit
 * @returns {boolean}
 */
function hasAddOn(unit) {
  return String(unit.addOnTag) !== '0';
}

/**
 * Helper function to determine if a unitType is a gas collector
 * @param {number} unitType - The unit type ID to check
 * @returns {boolean} - Returns true if the unit type is a gas collector, false otherwise
 */
function isGasCollector(unitType) {
  return groupTypes.gasMineTypes.includes(unitType);
}

/**
 * Determines if the geyser at the given position is unoccupied.
 * @param {World} world - The game world state.
 * @param {Point2D} position - The position to check for an unoccupied geyser.
 * @returns {boolean} - Returns true if the geyser is free, false otherwise.
 */
function isGeyserFree(world, position) {
  // Retrieve all gas collectors on the map from 'world'
  const gasCollectors = world.resources.get().units.getByType(groupTypes.gasMineTypes);

  // Check if any gas collector is at 'position'
  for (const collector of gasCollectors) {
    // Ensure collector position is defined before comparing
    if (collector.pos && positionIsEqual(collector.pos, position)) {
      return false; // There's a gas collector at 'position'
    }
  }

  // If no gas collector is found at 'position', the geyser is free
  return true;
}

/**
 * Determines if a position should be kept for building construction.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The unit type ID for the building.
 * @param {Point2D} position - The position to evaluate.
 * @param {(map: MapResource, unitType: number, position: Point2D) => boolean} isPlaceableAtGasGeyser - Dependency for gas geyser placement.
 * @returns {boolean} - Whether the position should be kept.
 */
function keepPosition(world, unitType, position, isPlaceableAtGasGeyser) {
  const { race } = world.agent;
  if (race === undefined) return false;

  const { map, units } = world.resources.get();
  let isPositionValid = map.isPlaceableAt(unitType, position) || isPlaceableAtGasGeyser(map, unitType, position);

  if (race === Race.PROTOSS && unitType !== UnitType.PYLON) {
    let pylons = units.getById(UnitType.PYLON);
    let pylonExists = pylons.some(pylon => pylon.isPowered || (pylon.buildProgress && pylon.buildProgress < 1));
    isPositionValid = isPositionValid && pylonExists;
  }

  return isPositionValid;
}

/**
 * Moves a builder to a position in preparation for building.
 * @param {World} world 
 * @param {Point2D} position 
 * @param {UnitTypeId} unitType
 * @param {(world: World, position: Point2D) => {unit: Unit, timeToPosition: number} | undefined} getBuilderFunc
 * @param {(position: Point2D, unitType: UnitTypeId) => Point2D} getMiddleOfStructureFn
 * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCostFn
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function premoveBuilderToPosition(world, position, unitType, getBuilderFunc, getMiddleOfStructureFn, getTimeToTargetCostFn) {
  const { constructionAbilities, gasMineTypes, workerTypes } = groupTypes;
  const { agent, data, resources } = world;
  if (earmarkThresholdReached(data)) return [];
  const { debug, map, units } = resources.get();

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  position = getMiddleOfStructureFn(position, unitType);
  const builder = getBuilderFunc(world, position);
  if (builder) {
    let { unit, timeToPosition, movementSpeedPerSecond } = getBuilderInformation(builder);
    const { orders, pos } = unit; if (orders === undefined || pos === undefined) return collectedActions;
    const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, position);
    const { pathCoordinates, pathableTargetPosition } = closestPathablePositionBetweenPositions;
    if (debug !== undefined) {
      debug.setDrawCells('prmv', getPathCoordinates(getMapPath(map, pos, pathableTargetPosition)).map(point => ({ pos: point })), { size: 1, cube: false });
    }
    let rallyBase = false;
    let buildTimeLeft = 0;
    const completedBases = units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1);
    const [closestBaseByPath] = getClosestUnitByPath(resources, pathableTargetPosition, completedBases);
    if (closestBaseByPath) {
      const pathablePositions = getPathablePositionsForStructure(map, closestBaseByPath);
      const [pathableStructurePosition] = getClosestPositionByPath(resources, pathableTargetPosition, pathablePositions);
      const baseDistanceToPosition = getDistanceByPath(resources, pathableStructurePosition, pathableTargetPosition);
      const workerCurrentlyTraining = closestBaseByPath.orders ?
        closestBaseByPath.orders.some(order => {
          const abilityId = order.abilityId;
          if (abilityId === undefined) {
            return false;
          }
          const unitTypeForAbility = unitTypeTrainingAbilities.get(abilityId);
          return unitTypeForAbility !== undefined && workerTypes.includes(unitTypeForAbility);
        }) :
        false;

      if (workerCurrentlyTraining) {
        const { buildTime } = data.getUnitTypeData(WorkerRace[agent.race || Race.TERRAN]);
        const progress = closestBaseByPath.orders?.[0]?.progress;
        if (buildTime === undefined || progress === undefined) return collectedActions;
        buildTimeLeft = getBuildTimeLeft(closestBaseByPath, buildTime, progress);
        let baseTimeToPosition = calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond);
        rallyBase = timeToPosition > baseTimeToPosition;
        timeToPosition = rallyBase ? baseTimeToPosition : timeToPosition;
      }
    }
    const pendingConstructionOrder = getPendingOrders(unit).some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
    const unitCommand = builder ? createUnitCommand(Ability.MOVE, [unit], pendingConstructionOrder) : {};
    const timeToTargetCost = getTimeToTargetCostFn(world, unitType);
    const timeToTargetTech = getTimeToTargetTech(world, unitType);
    const timeToTargetCostOrTech = timeToTargetTech > timeToTargetCost ? timeToTargetTech : timeToTargetCost;
    const gameState = GameState.getInstance();
    if (gameState.shouldPremoveNow(world, timeToTargetCostOrTech, timeToPosition)) {
      if (agent.race === Race.PROTOSS && !gasMineTypes.includes(unitType)) {
        if (pathCoordinates.length >= 2) {
          const secondToLastPosition = pathCoordinates[pathCoordinates.length - 2];
          position = avgPoints([secondToLastPosition, position, position]);
        }
      }
      if (rallyBase) {
        collectedActions.push(...handleRallyBase(world, unit, position));
      } else {
        collectedActions.push(...handleNonRallyBase(world, unit, position, unitCommand, unitType, getOrderTargetPosition));
      }
    } else {
      collectedActions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));
    }
  }
  return collectedActions;
}

// Export all the consolidated functions
module.exports = {
  determineBuildingPosition,
  findBestPositionForAddOn,
  getBuilderInformation,
  getInTheMain,
  hasAddOn,
  keepPosition,
  premoveBuilderToPosition,
};
