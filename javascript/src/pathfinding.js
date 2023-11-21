//@ts-check
"use strict"

const { areEqual, getClosestPathablePositions } = require("./common");
const { getDistance } = require("./geometryUtils");
// pathfinding.js


/** @type {Map<string, number[][]>} */
let pathCache = new Map();

/**
 * @param {MapResource} map
 * @param {Point2D} start
 * @param {Point2D} end
 * @param {MapPathOptions} options
 * @returns {number[][]}
 */
function getMapPath(map, start, end, options = {})  {
  const [startGrid, endGrid] = [getClosestPathablePositions(map, start)[0], getClosestPathablePositions(map, end)[0]];

  start = startGrid || start;
  end = endGrid || end;

  if (areEqual(start, end)) {
    return [];
  }

  const pathKey = `${start.x},${start.y}-${end.x},${end.y}`;

  if (pathCache.has(pathKey)) {
    const cachedPath = pathCache.get(pathKey) || [];
    const pathCoordinates = getPathCoordinates(cachedPath);

    if (pathCoordinates.every(coordinate => map.isPathable(coordinate))) {
      return cachedPath;
    }

    pathCache.delete(pathKey);
  }

  const mapPath = map.path(start, end, options);
  if (mapPath.length === 0) {
    return [];
  }

  pathCache.set(pathKey, mapPath);

  for (let i = 1; i < mapPath.length; i++) {
    const subStart = mapPath[i];
    const subPathKey = `${subStart[0]},${subStart[1]}-${end.x},${end.y}`;
    if (!pathCache.has(subPathKey)) {
      pathCache.set(subPathKey, mapPath.slice(i));
    } else {
      // If the path from the current point to the end is already cached, 
      // there's no need to set it for the rest of the points in the current path.
      break;
    }
  }

  return mapPath;
}

/**
 * @param {number[][]} path 
 * @returns {Point2D[]}
 */
function getPathCoordinates(path) {
  return path.map(path => ({ 'x': path[0], 'y': path[1] }));
}

/**
 * @param {MapResource} map
 * @param {Point2D[]} line - An array containing two points that define a straight line segment.
 * @returns {boolean}
 */
function isLineTraversable(map, line) {
  const [start, end] = line;
  const { x: startX, y: startY } = start; if (startX === undefined || startY === undefined) return false;
  const { x: endX, y: endY } = end; if (endX === undefined || endY === undefined) return false;

  // Use fallback value if getDistance returns undefined
  const distance = getDistance(start, end) || 0;

  // Assume the unit width is 1
  const unitWidth = 1;

  // Calculate the number of points to check along the line, spaced at unit-width intervals
  const numPoints = distance === 0 ? 0 : Math.ceil(distance / unitWidth);

  // For each point along the line segment
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints; // The fraction of the way from the start point to the end point

    // Calculate the coordinates of the point
    const x = startX + t * (endX - startX);
    const y = startY + t * (endY - startY);
    const point = { x, y };

    // If the point is not on walkable terrain, return false
    if (!map.isPathable(point)) {
      return false;
    }
  }

  // If all points along the line are on walkable terrain, return true
  return true;
}

/**
 *
 * @param {ResourceManager} resources
 * @param {Point2D|SC2APIProtocol.Point} position
 * @param {Unit[]} units
 * @param {Unit[]} gasGeysers
 * @param {number} n
 * @returns {Unit[]}
 */
function getClosestUnitByPath(resources, position, units, gasGeysers = [], n = 1) {
  const { map } = resources.get();

  const splitUnits = units.reduce((/** @type {{within16: Unit[], outside16: Unit[]}} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    // Use a fallback value if getDistance returns undefined
    const distanceToUnit = getDistance(pos, position) || Number.MAX_VALUE;
    const pathablePosData = this.getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const distanceByPath = this.getDistanceByPath(resources, pathablePosData.pathablePosition, pathablePosData.pathableTargetPosition) || Number.MAX_VALUE;

    const isWithin16 = distanceToUnit <= 16 && distanceByPath <= 16;
    return {
      within16: isWithin16 ? [...acc.within16, unit] : acc.within16,
      outside16: isWithin16 ? acc.outside16 : [...acc.outside16, unit]
    };
  }, { within16: [], outside16: [] });

  let closestUnits = splitUnits.within16.sort((a, b) => {
    const { pos } = a; if (pos === undefined) return 1;
    const { pos: bPos } = b; if (bPos === undefined) return -1;
    const aData = this.getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const bData = this.getClosestPathablePositionsBetweenPositions(resources, bPos, position, gasGeysers);
    return this.getDistanceByPath(resources, aData.pathablePosition, aData.pathableTargetPosition) - this.getDistanceByPath(resources, bData.pathablePosition, bData.pathableTargetPosition);
  });

  if (n === 1 && closestUnits.length > 0) return closestUnits;

  const unitsByDistance = [...closestUnits, ...splitUnits.outside16].reduce((/** @type {{unit: Unit, distance: number}[]} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    const expansionWithin16 = map.getExpansions().find(expansion => {
      const { centroid: expansionPos } = expansion;
      if (expansionPos === undefined) return false;

      const pathablePosData = this.getClosestPathablePositionsBetweenPositions(resources, expansionPos, pos, gasGeysers);
      if (!pathablePosData) return false;

      // Use fallback values if getDistance or pathablePosData.distance returns undefined
      const distanceToExpansion = getDistance(expansionPos, pos) || Number.MAX_VALUE;
      const distanceByPath = pathablePosData.distance || Number.MAX_VALUE;

      return distanceToExpansion <= 16 && distanceByPath <= 16;
    });

    if (!expansionWithin16 || !expansionWithin16.centroid) return acc;
    const closestPathablePositionBetweenPositions = this.getClosestPathablePositionsBetweenPositions(resources, expansionWithin16.centroid, position, gasGeysers);
    if (!closestPathablePositionBetweenPositions) return acc;

    // Add only if closestPathablePositionBetweenPositions.distance is defined
    if (typeof closestPathablePositionBetweenPositions.distance === 'number') {
      acc.push({ unit, distance: closestPathablePositionBetweenPositions.distance });
    }
    return acc;
  }, []).sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.distance - b.distance;
  });

  return unitsByDistance.slice(0, n).map(u => u.unit);
}

module.exports = {
  getMapPath,
  pathCache,
  getPathCoordinates,
  isLineTraversable,
  getClosestUnitByPath,
};