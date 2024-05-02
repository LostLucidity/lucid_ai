//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");
const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

const cacheManager = require("./cache");
const { getDistance } = require("../../gameLogic/spatial/spatialCoreUtils");


/**
 * @typedef {Object.<string, number>} UnitTypeMap
 */

/**
 * Compares two positions for equality.
 *
 * @param {SC2APIProtocol.Point} pos1 - The first position.
 * @param {SC2APIProtocol.Point} pos2 - The second position.
 * @returns {boolean} - True if the positions are equal, false otherwise.
 */
function areEqual(pos1, pos2) {
  return pos1.x === pos2.x && pos1.y === pos2.y;
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
 * @param {MapResource} map
 * @param {Point2D} position 
 * @returns {Point2D[]}
 */
function getClosestPathablePositions(map, position) {
  const { x, y } = position;
  if (x === undefined || y === undefined) return [position];

  const gridCorners = [
    { x: Math.floor(x), y: Math.floor(y) },
    { x: Math.ceil(x), y: Math.floor(y) },
    { x: Math.floor(x), y: Math.ceil(y) },
    { x: Math.ceil(x), y: Math.ceil(y) },
  ].filter((grid, index, self) => {
    const mapSize = map.getSize();
    const mapEdge = { x: mapSize.x, y: mapSize.y };
    if (grid.x === mapEdge.x || grid.y === mapEdge.y) return false;
    return self.findIndex(g => areEqual(g, grid)) === index;
  });

  const placeableCorners = gridCorners.filter(corner => map.isPathable(corner));

  // Use fallback value if getDistance returns undefined
  const sortedCorners = placeableCorners.sort((a, b) => {
    const distanceA = getDistance(a, position) || Number.MAX_VALUE;
    const distanceB = getDistance(b, position) || Number.MAX_VALUE;
    return distanceA - distanceB;
  });

  // Filter out corners that have the same minimum distance
  const closestCorners = sortedCorners.filter(corner => {
    const minDistance = getDistance(sortedCorners[0], position) || Number.MAX_VALUE;
    return (getDistance(corner, position) || Number.MAX_VALUE) === minDistance;
  });

  return closestCorners;
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
 * @param {MapResource} map
 * @param {Unit} structure 
 * @return {Point2D[]}
 */
function getPathablePositionsForStructure(map, structure) {
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
 * Checks if a line between two points is traversable on the map.
 * @param {MapResource} map - The map object.
 * @param {Point2D} start - The start point of the line.
 * @param {Point2D} end - The end point of the line.
 * @returns {boolean} - True if the line is traversable, false otherwise.
 */
function isLineTraversable(map, start, end) {
  // Ensure both points have defined x and y values
  if (typeof start.x !== 'number' || typeof start.y !== 'number' ||
    typeof end.x !== 'number' || typeof end.y !== 'number') {
    throw new Error("Start or end points are not properly defined.");
  }

  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);

  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;

  let err = dx + dy;

  // Use the coordinates comparison as the loop condition
  while (!(x0 === x1 && y0 === y1)) {
    if (!map.isPathable({ x: x0, y: y0 })) {
      return false;
    }

    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }

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

module.exports = {
  canBuild,
  createUnitCommand,
  findKeysForValue,
  findUnitTypesWithAbilityCached,
  getClosestPathablePositions,
  getFoodUsedByUnitType,
  getLine,
  getPathablePositionsForStructure,
  getStringNameOfConstant,
  getUnitsWithinDistance,
  isLineTraversable,
  isPlaceableAtGasGeyser,
  positionIsEqual,
};