//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getPathCoordinates } = require("./path-service");

const MapResourceService = {
  /**
   * @param {MapResource} map 
   * @param {Point2D} position
   */
  getClosestExpansion: (map, position) => {
    return map.getExpansions().sort((a, b) => distance(a.townhallPosition, position) - distance(b.townhallPosition, position));
  },
  /**
   * @param {MapResource} map
   * @param {Point2D} start
   * @param {Point2D} end
   * @returns {number[][]}
   */
  getMapPath: (map, start, end) => {
    let force = false;
    let mapPath = map.path(start, end);
    mapPath = mapPath.length === 0 ? map.path(end, start) : mapPath;
    if (mapPath.length > 0) {
      // convert to array of points and check if any of the points are not pathable
      const pathCoordinates = getPathCoordinates(mapPath);
      const foundNonPathable = pathCoordinates.filter(coordinate => !map.isPathable(coordinate)).length > 1;
      if (foundNonPathable) {
        force = true;
        mapPath = map.path(start, end, { force });
        mapPath = mapPath.length === 0 ? map.path(end, start, { force }) : mapPath;
      }
    }
    return mapPath;
  },
  /**
   * @param {MapResource} map
   * @param {Point2D} position 
   * @return {Point2D[]}
   */
  getPathablePositions: (map, position) => {
    let pathablePositions = [];
    let radius = 0;
    if (map.isPathable(position)) {
      pathablePositions.push(position);
    }
    while (pathablePositions.length === 0) {
      pathablePositions = gridsInCircle(position, radius).filter(grid => map.isPathable(grid));
      radius += 1;
    }
    return pathablePositions;
  },
  /**
   * @param {MapResource} map
   * @param {Unit} structure 
   * @return {Point2D[]}
   */
  getPathablePositionsForStructure: (map, structure) => {
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
}

module.exports = MapResourceService;