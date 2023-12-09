//@ts-check
"use strict"

// src/utils.js

// External library imports from @node-sc2/core
const { UnitType } = require("@node-sc2/core/constants");
const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

// Internal module imports
const { areEqual, getClosestPathablePositions } = require("./common");
const { getDistance } = require("./geometryUtils");
const { isLineTraversable } = require("./mapUtils");
const { getMapPath, getPathCoordinates } = require("./pathUtils");

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
        const segment = [currentSegmentStart, point];

        if (!isLineTraversable(map, segment)) {
          straightLineSegments.push([currentSegmentStart, pathCoordinates[i - 1]]);
          currentSegmentStart = pathCoordinates[i - 1];
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
 * Creates a unit command action.
 * 
 * @param {AbilityId} abilityId - The ability ID for the action.
 * @param {Unit[]} units - The units to which the action applies.
 * @param {boolean} queue - Whether or not to queue the action.
 * @param {Point2D} [targetPos] - Optional target position for the action.
 * 
 * @returns {SC2APIProtocol.ActionRawUnitCommand} - The unit command action.
 */
function createUnitCommand(abilityId, units, queue = false, targetPos) {
  const unitCommand = {
    abilityId,
    unitTags: units.reduce((/** @type {string[]} */ acc, unit) => {
      if (unit.tag !== undefined) {
        acc.push(unit.tag);
      }
      return acc;
    }, []),
    queueCommand: queue,
  };

  if (targetPos) {
    unitCommand.targetWorldSpacePos = targetPos;
  }

  return unitCommand;
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

module.exports = {
  findKeysForValue,
  getFoodUsedByUnitType,
  getPathablePositionsForStructure,
  getStringNameOfConstant,
  getUnitsWithinDistance,
  getDistanceByPath,
  getLine,
  createUnitCommand,
  isSupplyNeeded,
  canBuild,
  getTimeInSeconds,
};
