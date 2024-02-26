//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

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

/**
 * Calculate a position away from a building given a unit's position.
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
 * Determines if two points are approximately equal within a small margin of error.
 * @param {SC2APIProtocol.Point2D} point1
 * @param {SC2APIProtocol.Point2D} point2
 * @param {number} epsilon - The margin of error for comparison.
 * @returns {boolean}
 */
const areApproximatelyEqual = (point1, point2, epsilon = 0.0002) => {
  if (point1.x === undefined || point1.y === undefined || point2.x === undefined || point2.y === undefined) {
    return false;
  }

  const dx = Math.abs(point1.x - point2.x);
  const dy = Math.abs(point1.y - point2.y);

  return dx < epsilon && dy < epsilon;
};

/**
 * Finds the intersection of two arrays of points.
 * @param {Point2D[]} firstArray 
 * @param {Point2D[]} secondArray 
 * @returns {Point2D[]}
 */
function intersectionOfPoints(firstArray, secondArray) {
  return firstArray.filter(first =>
    secondArray.some(second => getDistance(first, second) < 1)
  );
}

/**
 * Checks if any points in two arrays are within a specified range of each other.
 * 
 * @param {Point2D[]} firstArray - The first array of points.
 * @param {Point2D[]} secondArray - The second array of points.
 * @param {number} [range=1] - The range within which points are considered to overlap.
 * @returns {boolean} - Returns true if any point in the first array is within the specified range of any point in the second array, otherwise false.
 */
function pointsOverlap(firstArray, secondArray, range = 1) {
  const cellSize = range;

  /**
   * Grid to store points, mapped to their corresponding cells.
   * Each cell is identified by a string key in the format 'x,y', 
   * and contains an array of points that fall into that cell.
   * @type {Map<string, Point2D[]>}
   */
  const grid = new Map();

  for (const point of secondArray) {
    if (point.x === undefined || point.y === undefined) {
      continue; // Skip the point if x or y is undefined
    }

    const xCell = Math.floor(point.x / cellSize);
    const yCell = Math.floor(point.y / cellSize);
    const key = `${xCell},${yCell}`;

    // Directly initialize the array if it doesn't exist, then push the point
    const cell = grid.get(key) || [];
    cell.push(point);
    grid.set(key, cell);
  }

  return firstArray.some(first => {
    if (first.x === undefined || first.y === undefined) {
      return false; // Skip the point if x or y is undefined
    }

    const xCell = Math.floor(first.x / cellSize);
    const yCell = Math.floor(first.y / cellSize);

    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const key = `${xCell + i},${yCell + j}`;
        const pointsInCell = grid.get(key);

        if (pointsInCell && pointsInCell.some(second => getDistance(first, second) < range)) {
          return true;
        }
      }
    }

    return false;
  });
}

module.exports = {
  cellsInFootprint,
  getDistance,
  getFootprint,
  getStructureAtPosition,
  getGridsInCircleWithinMap,
  getClosestPosition,
  getAwayPosition,
  areApproximatelyEqual,
  intersectionOfPoints,
  pointsOverlap,
};