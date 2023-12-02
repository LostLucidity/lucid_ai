//@ts-check
"use strict";

const { getPathCache, clearPathCache, setPathCache } = require("./cacheModule");
const { getClosestPathablePositions, areEqual } = require("./common");
const { getGridsInCircleWithinMap, getDistance } = require("./geometryUtils");

const pathUtils = {
  /**
   * Calculates a path between two points on the map.
   * @param {MapResource} map
   * @param {Point2D} start
   * @param {Point2D} end
   * @param {MapPathOptions} options
   * @returns {number[][]}
   */
  getMapPath(map, start, end, options = {}) {
    const [startGrid, endGrid] = [getClosestPathablePositions(map, start)[0], getClosestPathablePositions(map, end)[0]];

    start = startGrid || start;
    end = endGrid || end;

    if (areEqual(start, end)) {
      return [];
    }

    const pathKey = `${start.x},${start.y}-${end.x},${end.y}`;

    if (getPathCache(pathKey)) {
      const cachedPath = getPathCache(pathKey) || [];
      const pathCoordinates = this.getPathCoordinates(cachedPath);

      if (pathCoordinates.every(coordinate => map.isPathable(coordinate))) {
        return cachedPath;
      }

      clearPathCache(pathKey);
    }

    const mapPath = map.path(start, end, options);
    if (mapPath.length === 0) {
      return [];
    }

    setPathCache(pathKey, mapPath);

    for (let i = 1; i < mapPath.length; i++) {
      const subStart = mapPath[i];
      const subPathKey = `${subStart[0]},${subStart[1]}-${end.x},${end.y}`;
      if (!getPathCache(subPathKey)) {
        setPathCache(subPathKey, mapPath.slice(i));
      } else {
        // If the path from the current point to the end is already cached, 
        // there's no need to set it for the rest of the points in the current path.
        break;
      }
    }

    return mapPath;
  }, 
  /**
   * @param {number[][]} path 
   * @returns {Point2D[]}
   */ 
  getPathCoordinates(path) {
    return path.map(path => ({ 'x': path[0], 'y': path[1] }));
  },
  /**
   * @param {MapResource} map
   * @param {Point2D} position 
   * @return {Point2D[]}
   */
  getPathablePositions(map, position) {
    let pathablePositions = [];
    let radius = 0;
    const closestPathablePositions = getClosestPathablePositions(map, position);
    pathablePositions.push(...closestPathablePositions);
    while (pathablePositions.length === 0) {

      pathablePositions = getGridsInCircleWithinMap(map, position, radius).filter(grid => map.isPathable(grid));
      radius += 1;
    }
    return pathablePositions;
  },
  /**
   * @param {Point2D[]} positions 
   * @param {Point2D} position 
   * @returns {Boolean}
   */
  checkIfPositionIsCorner(positions, position) {
    return positions.some(pos => {
      const { x, y } = position;
      const { x: pathableX, y: pathableY } = pos;
      if (x === undefined || y === undefined || pathableX === undefined || pathableY === undefined) { return false; }
      const halfway = Math.abs(x - pathableX) === 0.5 || Math.abs(y - pathableY) === 0.5;
      return halfway && getDistance(position, pos) <= 1;
    });
  }
};

module.exports = pathUtils;
