const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { getGridsInCircleWithinMap } = require("./spatialCore");
const { getDistance } = require("./spatialCoreUtils");
const cacheManager = require("../../core/utils/cache");
const { getClosestPathablePositions } = require("../../core/utils/common");

/**
 * @param {Point2D[]} positions 
 * @param {Point2D} position 
 * @returns {Boolean}
 */
function checkIfPositionIsCorner(positions, position) {
  return positions.some(pos => {
    const { x, y } = position;
    const { x: pathableX, y: pathableY } = pos;
    if (x === undefined || y === undefined || pathableX === undefined || pathableY === undefined) { return false; }
    const halfway = Math.abs(x - pathableX) === 0.5 || Math.abs(y - pathableY) === 0.5;
    return halfway && getDistance(position, pos) <= 1;
  });
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
 * Calculates a path between two points on the map.
 * @param {MapResource} map
 * @param {Point2D} start
 * @param {Point2D} end
 * @param {MapPathOptions} options
 * @returns {number[][]}
 */
function getMapPath(map, start, end, options = {}) {
  const [startGrid, endGrid] = [getClosestPathablePositions(map, start)[0], getClosestPathablePositions(map, end)[0]];

  start = startGrid || start;
  end = endGrid || end;

  if (areEqual(start, end)) {
    return [];
  }

  const pathKey = `${start.x},${start.y}-${end.x},${end.y}`;

  if (cacheManager.getPathCache(pathKey)) {
    const cachedPath = cacheManager.getPathCache(pathKey) || [];
    const pathCoordinates = getPathCoordinates(cachedPath);

    if (pathCoordinates.every(coordinate => map.isPathable(coordinate))) {
      return cachedPath;
    }

    cacheManager.clearPathCache(pathKey);
  }

  const mapPath = map.path(start, end, options);
  if (mapPath.length === 0) {
    return [];
  }

  cacheManager.setPathCache(pathKey, mapPath);

  for (let i = 1; i < mapPath.length; i++) {
    const subStart = mapPath[i];
    const subPathKey = `${subStart[0]},${subStart[1]}-${end.x},${end.y}`;
    if (!cacheManager.getPathCache(subPathKey)) {
      cacheManager.setPathCache(subPathKey, mapPath.slice(i));
    } else {
      // If the path from the current point to the end is already cached, 
      // there's no need to set it for the rest of the points in the current path.
      break;
    }
  }

  return mapPath;
}

/**
 * @param {MapResource} map
 * @param {Point2D} position 
 * @return {Point2D[]}
 */
function getPathablePositions(map, position) {
  let pathablePositions = [];
  let radius = 0;
  const closestPathablePositions = getClosestPathablePositions(map, position);
  pathablePositions.push(...closestPathablePositions);
  while (pathablePositions.length === 0) {

    pathablePositions = getGridsInCircleWithinMap(map, position, radius).filter(grid => map.isPathable(grid));
    radius += 1;
  }
  return pathablePositions;
}

/**
 * @param {Path} path 
 * @returns {Point2D[]}
 */
function getPathCoordinates(path) {
  return path.map(path => ({ 'x': path[0], 'y': path[1] }));
}

/**
 * Retrieves cell positions occupied by given structures.
 * @param {Point2D} position - The position to check around.
 * @param {Unit[]} structures - The structures to consider.
 * @returns {Point2D[]} - Array of cells occupied by the structures.
 */
function getStructureCells(position, structures) {
  return structures.reduce((/** @type {Point2D[]} */ acc, structure) => {
    const { pos, unitType } = structure;
    if (pos === undefined || unitType === undefined) return acc;
    if (getDistance(pos, position) <= 1) {
      const footprint = getFootprint(unitType);
      if (footprint === undefined) return acc;
      acc.push(...cellsInFootprint(createPoint2D(pos), footprint));
    }
    return acc;
  }, []);
}

module.exports = {
  checkIfPositionIsCorner,
  getClosestPosition,
  getMapPath,
  getPathablePositions,
  getPathCoordinates,
  getStructureCells,
};