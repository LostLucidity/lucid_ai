// buildingPlacementUtils.js

"use strict";

// External and internal module imports specific to building placements
const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");

const { positionIsEqual } = require("../../core/utils/common");
const { logMessageStorage } = require("../../core/utils/logging");
const { getAddOnPlacement } = require("../../gameLogic/pathfinding");
const { getDistance } = require("../../gameLogic/spatialCoreUtils");
const { canLiftOff } = require("../../units/management/unitConfig");

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
 * Finds the best position for adding an add-on to a building.
 * @param {World} world - The game world context.
 * @param {Unit} unit - The unit (building) to find an add-on position for.
 * @param {(world: World, unit: Unit, addOnType?: UnitTypeId) => Point2D | undefined} checkAddOnPlacement - Function to check the add-on placement.
 * @param {boolean} logCondition - Whether to log the diagnostic messages.
 * @returns {Point2D | undefined} - The best position for the add-on, or undefined if none found.
 */
function findBestPositionForAddOn(world, unit, checkAddOnPlacement, logCondition = false) {
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
 * Determines if a position is suitable for placing a building near a gas geyser.
 * 
 * @param {MapResource} map 
 * @param {UnitTypeId} unitType
 * @param {Point2D} position
 * @returns {boolean}
 */
function isPlaceableAtGasGeyser(map, unitType, position) {
  return groupTypes.gasMineTypes.includes(unitType) && map.freeGasGeysers().some(gasGeyser => gasGeyser.pos && getDistance(gasGeyser.pos, position) <= 1);
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

  const { map } = world.resources.get();
  let isPositionValid = map.isPlaceableAt(unitType, position) || isPlaceableAtGasGeyser(map, unitType, position);

  // Only fetch and process pylons if the race is Protoss and the unit to be placed is not a Pylon
  if (race === Race.PROTOSS && unitType !== UnitType.PYLON) {
    const pylons = world.resources.get().units.getById(UnitType.PYLON);
    const pylonExists = pylons.some(pylon => pylon.isPowered || (pylon.buildProgress !== undefined && pylon.buildProgress <= 1));
    isPositionValid = isPositionValid && pylonExists;
  }

  return isPositionValid;
}

function logNoFreeGeysers() {
  if (!logMessageStorage.noFreeGeysers) {
    console.error('No free geysers available for gas collector');
    logMessageStorage.noFreeGeysers = true;
  } else {
    logMessageStorage.noFreeGeysers = false;
  }
}

module.exports = {
  determineBuildingPosition,
  findBestPositionForAddOn,
  getInTheMain,
  keepPosition,
  hasAddOn,
  isGasCollector,
  isGeyserFree,
  isPlaceableAtGasGeyser,
};
