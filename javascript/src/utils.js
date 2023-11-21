//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { getMapPath, getPathCoordinates, isLineTraversable } = require("./pathfinding");
const { getDistance } = require("./geometryUtils");
const { areEqual, getClosestPathablePositions } = require("./common");
// src/utils.js


let gasGeysers;

/**
 * Calculates the distance between two points.
 * @param {Point2D} pointA - First point.
 * @param {Point2D} pointB - Second point.
 * @returns {number} - The distance between the two points.
 */
function calculateDistance(pointA, pointB) {
  return Math.sqrt(Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2));
}

/**
 * Finds the closest expansion to a given position.
 * @param {MapResource} map - The map resource object from the bot.
 * @param {Point2D} position - The position to compare against expansion locations.
 * @returns {Expansion | undefined} The closest expansion, or undefined if not found.
 */
function getClosestExpansion(map, position) {
  const expansions = map.getExpansions();
  if (expansions.length === 0) return undefined;

  return expansions.sort((a, b) => {
    // Use a fallback value (like Number.MAX_VALUE) if getDistance returns undefined
    const distanceA = getDistance(a.townhallPosition, position) || Number.MAX_VALUE;
    const distanceB = getDistance(b.townhallPosition, position) || Number.MAX_VALUE;
    return distanceA - distanceB;
  })[0];
}

/**
 * Retrieves pending orders for a unit.
 * @param {Unit} unit - The unit to retrieve pending orders for.
 * @returns {SC2APIProtocol.UnitOrder[]} An array of pending orders.
 */
function getPendingOrders(unit) {
  return unit['pendingOrders'] || [];
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
 * Retrieves gas geyser units from the unit resource.
 * @param {UnitResource} units - The unit resource object from the bot.
 * @returns {Unit[]}
 */
function getGasGeysers(units) {
  return gasGeysers || (gasGeysers = units.getGasGeysers());
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

module.exports = {
  calculateDistance,
  getClosestExpansion,
  getPendingOrders,
  getPathablePositionsForStructure,
  getUnitsWithinDistance,
  getDistanceByPath,
  getLine,
  getGasGeysers,
  createUnitCommand,
};
