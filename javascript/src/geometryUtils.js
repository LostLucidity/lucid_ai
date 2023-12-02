//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

// src/geometryUtils.js

/**
 * Calculate the Euclidean distance between two points.
 * Returns a large number if either point is undefined.
 * 
 * @param {SC2APIProtocol.Point | undefined} point1
 * @param {SC2APIProtocol.Point | undefined} point2
 * @returns {number} The distance, or a large number if either point is undefined.
 */
function getDistance(point1, point2) {
  if (point1 && point2 && typeof point1.x === 'number' && typeof point1.y === 'number' && typeof point2.x === 'number' && typeof point2.y === 'number') {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return Number.MAX_VALUE; // Return a very large number to signify an undefined or unmeasurable distance
}

/**
 * Finds the closest N positions to a given reference position.
 * @param {Point2D} position - The reference position.
 * @param {Point2D[]} locations - An array of positions to compare against.
 * @param {number} n - The number of closest positions to find.
 * @returns {Point2D[]} An array of the closest N positions.
 */
function getClosestPosition(position, locations, n = 1) {
  let sortedLocations = locations.map(location => ({ location, distance: getDistance(position, location) }));
  sortedLocations.sort((a, b) => a.distance - b.distance);
  return sortedLocations.slice(0, n).map(u => u.location);
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
    return getDistance(pos, movingPosition) < 1;
  });
}

/**
 * 
 * @param {MapResource} map 
 * @param {Point2D} position 
 * @param {number} radius 
 * @returns {Point2D[]}
 */
function getGridsInCircleWithinMap(map, position, radius) {
  const grids = gridsInCircle(position, radius);
  return grids.filter(grid => {
    const { x: gridX, y: gridY } = grid;
    const { x: mapX, y: mapY } = map.getSize();
    if (gridX === undefined || gridY === undefined || mapX === undefined || mapY === undefined) return false;
    return gridX >= 0 && gridX < mapX && gridY >= 0 && gridY < mapY;
  });
}

module.exports = {
  getDistance,
  getStructureAtPosition,
  getGridsInCircleWithinMap,
  getClosestPosition,
};