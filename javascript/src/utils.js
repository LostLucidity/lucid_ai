//@ts-check
"use strict"

// src/utils.js

// External library imports from @node-sc2/core
const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

// Internal module imports
const cacheManager = require("./cacheManager");
const { areEqual, getClosestPathablePositions } = require("./common");
const { getDistance } = require("./geometryUtils");
const { isLineTraversable } = require("./mapUtils");
const { getMapPath, getPathCoordinates } = require("./pathUtils");

/**
 * Creates a unit command action.
 * 
 * @param {number} abilityId - The ability ID for the action.
 * @param {Unit[]} units - The units to which the action applies.
 * @param {boolean} [queue=false] - Whether or not to queue the action.
 * @param {Point2D} [targetPos] - Optional target position for the action.
 * 
 * @returns {SC2APIProtocol.ActionRawUnitCommand} - The unit command action.
 */
function createUnitCommand(abilityId, units, queue = false, targetPos) {
  // Create an object with the structure of ActionRawUnitCommand
  /** @type {SC2APIProtocol.ActionRawUnitCommand} */
  const unitCommand = {
    abilityId: abilityId,
    unitTags: units.reduce((/** @type {string[]} */ acc, unit) => {
      if (unit.tag !== undefined) {
        acc.push(unit.tag);
      }
      return acc;
    }, []),
    queueCommand: queue
  };

  // Conditionally add targetWorldSpacePos if it is provided
  if (targetPos) {
    unitCommand.targetWorldSpacePos = targetPos;
  }

  return unitCommand;
}

/**
 * Finds all keys in a map that correspond to a specific target value.
 * 
 * @param {Map<K, V>} map - The map to search through.
 * @param {V} targetValue - The value to find the keys for.
 * @returns {K[]} - An array of keys that correspond to the target value.
 * @template K, V
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
 * Finds unit types with a specific ability, using caching to improve performance.
 * @param {DataStorage} dataStorage - The data storage instance.
 * @param {number} abilityId - The ID of the ability to find unit types for.
 * @returns {number[]} - The list of unit type IDs with the specified ability.
 */
function findUnitTypesWithAbilityCached(dataStorage, abilityId) {
  let cachedResult = cacheManager.getUnitTypeAbilityData(abilityId);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  // Accessing data from the passed-in DataStorage instance
  let result = dataStorage.findUnitTypesWithAbility(abilityId);

  // Cache the result for future use
  cacheManager.cacheUnitTypeAbilityData(abilityId, result);

  return result;
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

/**
 * @param {MapResource} map
 * @param {Unit} structure 
 * @return {Point2D[]}
 */
function getPathablePositionsForStructure(map, structure){
  const { pos } = structure;
  if (pos === undefined) return [];
  let positions = []
  let radius = 1
  if (map.isPathable(pos)) {
    positions.push(pos);
  } else {
    do {
      positions = gridsInCircle(pos, radius).filter(position => map.isPathable(position));
      radius++
    } while (positions.length === 0);
  }
  return positions;
}

/**
 * @param {{ [x: string]: any; }} constants
 * @param {any} value
 */
function getStringNameOfConstant(constants, value) {
  return `${Object.keys(constants).find(constant => constants[constant] === value)}`;
}

/**
 * @param {Point2D} pos 
 * @param {Unit[]} units 
 * @param {Number} maxDistance
 * @returns {Unit[]}
 */
function getUnitsWithinDistance(pos, units, maxDistance) {
  return units.filter(unit => {
    const { pos: unitPos } = unit;
    if (!unitPos) return false;

    // Use fallback value if getDistance returns undefined
    const distance = getDistance(unitPos, pos) || Number.MAX_VALUE;
    return distance <= maxDistance;
  });
}

/**
  * @param {ResourceManager} resources
  * @param {Point2D} position
  * @param {Point2D|SC2APIProtocol.Point} targetPosition
  * @returns {number}
  */
function getDistanceByPath(resources, position, targetPosition) {
  const { map } = resources.get();
  try {
    const line = getLine(position, targetPosition);
    let distance = 0;
    const everyLineIsPathable = line.every((point, index) => {
      if (index > 0) {
        const previousPoint = line[index - 1];
        const heightDifference = map.getHeight(point) - map.getHeight(previousPoint);
        return Math.abs(heightDifference) <= 1;
      }
      const [closestPathablePosition] = getClosestPathablePositions(map, point);
      return closestPathablePosition !== undefined && map.isPathable(closestPathablePosition);
    });
    if (everyLineIsPathable) {
      return getDistance(position, targetPosition) || 0;
    } else {
      let path = getMapPath(map, position, targetPosition);
      const pathCoordinates = getPathCoordinates(path);

      let straightLineSegments = [];
      let currentSegmentStart = pathCoordinates[0];

      for (let i = 1; i < pathCoordinates.length; i++) {
        const point = pathCoordinates[i];
        const previousPoint = pathCoordinates[i - 1];

        // Corrected usage of isLineTraversable with required three arguments
        if (!isLineTraversable(map, previousPoint, point)) {
          straightLineSegments.push([currentSegmentStart, previousPoint]);
          currentSegmentStart = point;
        }
      }

      straightLineSegments.push([currentSegmentStart, pathCoordinates[pathCoordinates.length - 1]]);

      distance = straightLineSegments.reduce((acc, segment) => {
        const segmentDistance = getDistance(segment[0], segment[1]) || 0;
        return acc + segmentDistance;
      }, 0);

      const calculatedZeroPath = path.length === 0;
      const zeroPathDistance = calculatedZeroPath ? getDistance(position, targetPosition) || 0 : 0;
      const isZeroPathDistance = calculatedZeroPath && zeroPathDistance <= 2;
      const isNotPathable = calculatedZeroPath && !isZeroPathDistance;
      const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : distance;
      return pathLength;
    }
  } catch (error) {
    return Infinity;
  }
}

/**
 * @param {Point2D} start 
 * @param {Point2D} end 
 * @param {Number} steps
 * @returns  {Point2D[]}
 */
function getLine(start, end, steps = 0) {
  const points = [];
  if (areEqual(start, end)) return [start];
  const { x: startX, y: startY } = start;
  const { x: endX, y: endY } = end;
  if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) return [start];
  const dx = endX - startX;
  const dy = endY - startY;
  steps = steps === 0 ? Math.max(Math.abs(dx), Math.abs(dy)) : steps;
  for (let i = 0; i < steps; i++) {
    const x = startX + (dx / steps) * i;
    const y = startY + (dy / steps) * i;
    points.push({ x, y });
  }
  return points;
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitTypeId 
 * @returns {boolean}
 */
function canBuild(world, unitTypeId) {
  const { agent } = world;
  return agent.canAfford(unitTypeId) && agent.hasTechFor(unitTypeId) && (!isSupplyNeeded(world) || unitTypeId === UnitType.OVERLORD)
}

/**
 * @param {number} frames 
 * @returns {number}
 */
function getTimeInSeconds(frames) {
  return frames / 22.4;
}

/**
 * @typedef {Object} BuildOrderStep
 * @property {string} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
 */

/**
 * @typedef {Object} InterpretedStep
 * @property {number} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
 * @property {number} unitType - The unit type associated with this step.
 * @property {number} upgrade - The upgrade associated with this step.
 * @property {number} count - The number of units or upgrades.
 * @property {boolean} isChronoBoosted - Whether the action is Chrono Boosted.
 */

/**
 * Interprets a build order step and converts it into a PlanStep object.
 * @param {BuildOrderStep} step - A step from the build order.
 * @returns {InterpretedStep} A PlanStep object.
 */
function interpretBuildOrderStep(step) {
  const actionParts = step.action.split(' ');
  const baseAction = actionParts[0].toUpperCase();

  let unitType = safeGetProperty(UnitType, baseAction) || UnitType.INVALID;
  let upgrade = safeGetProperty(Upgrade, baseAction) || Upgrade.NULL;

  let isUpgrade = upgrade !== Upgrade.NULL;
  let isChronoBoosted = step.action.includes('Chrono Boost');
  let count = actionParts.includes('x') ? parseInt(actionParts[actionParts.indexOf('x') + 1], 10) : 1;

  return {
    supply: parseInt(step.supply, 10),
    time: step.time,
    action: step.action, // Include the 'action' property as required by InterpretedStep type
    unitType: isUpgrade ? UnitType.INVALID : unitType,
    upgrade: isUpgrade ? upgrade : Upgrade.NULL,
    count: count,
    isChronoBoosted: isChronoBoosted,
    // Add other relevant properties here
  };
}

/**
 * @param {World} world 
 * @param {number} buffer 
 * @returns {boolean} 
 */
function isSupplyNeeded(world, buffer = 0) {
  const { agent, data, resources } = world;
  const { foodCap, foodUsed } = agent;
  const { units } = resources.get();
  if (agent.race === undefined) {
    return false; // Skip logic if the race is not defined
  }
  const supplyUnitId = SupplyUnitRace[agent.race];
  const unitTypeData = data.getUnitTypeData(supplyUnitId);

  if (!unitTypeData || unitTypeData.abilityId === undefined || foodCap === undefined || foodUsed === undefined) {
    return false; // Skip logic if essential data is not available
  }

  const buildAbilityId = unitTypeData.abilityId;
  const pendingSupply = (
    (units.inProgress(supplyUnitId).length * 8) +
    (units.withCurrentOrders(buildAbilityId).length * 8)
  );
  const pendingSupplyCap = foodCap + pendingSupply;
  const supplyLeft = foodCap - foodUsed; // Now safe to use foodUsed
  const pendingSupplyLeft = supplyLeft + pendingSupply;
  const conditions = [
    pendingSupplyLeft < pendingSupplyCap * buffer,
    !(foodCap === 200),
  ];
  return conditions.every(c => c);
}

/**
 * Compares two positions to determine if they are the same.
 * @param {Point2D} pos1 - The first position.
 * @param {Point2D} pos2 - The second position.
 * @returns {boolean} - Returns true if positions are the same, false otherwise.
 */
function positionIsEqual(pos1, pos2) {
  const epsilon = 0.1; // Define a small tolerance for comparison
  if (pos1 && pos2 && typeof pos1.x === 'number' && typeof pos1.y === 'number' && typeof pos2.x === 'number' && typeof pos2.y === 'number') {
    return Math.abs(pos1.x - pos2.x) < epsilon && Math.abs(pos1.y - pos2.y) < epsilon;
  } else {
    return false; // Return false if any of the positions or coordinates are undefined
  }
}

/**
 * @typedef {Object.<string, number>} Dictionary
 * Represents a dictionary object with string keys and number values.
 */

/**
 * Safely gets a property value from an object.
 * @param {Dictionary} obj - The object from which to retrieve the property.
 * @param {string} key - The key of the property to retrieve.
 * @returns {number|undefined} The value of the property, or undefined if not found.
 */
function safeGetProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

module.exports = {
  createUnitCommand,
  findKeysForValue,
  findUnitTypesWithAbilityCached,
  getFoodUsedByUnitType,
  getPathablePositionsForStructure,
  getStringNameOfConstant,
  getUnitsWithinDistance,
  getDistanceByPath,
  getLine,
  interpretBuildOrderStep,
  isSupplyNeeded,
  canBuild,
  getTimeInSeconds,
  positionIsEqual,
};
