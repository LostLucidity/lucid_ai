//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getPathCoordinates } = require("./path-service");

const MapResourceService = {
  /**
   * @param {MapResource} map
   * @param {Point2D} position 
   * @returns {Point2D[]}
   */
  getClosestPathablePositions(map, position) {
    const { x, y } = position;
    if (x === undefined || y === undefined) return [position];
    const gridCorners = [
      { x: Math.floor(x), y: Math.floor(y) },
      { x: Math.ceil(x), y: Math.floor(y) },
      { x: Math.floor(x), y: Math.ceil(y) },
      { x: Math.ceil(x), y: Math.ceil(y) },
    ].filter((grid, index, self) => self.findIndex(g => areEqual(g, grid)) === index);
    const placeableCorners = gridCorners.filter(corner => map.isPathable(corner));
    const sortedCorners = placeableCorners.sort((a, b) => distance(a, position) - distance(b, position));
    const closestCorners = sortedCorners.filter(corner => distance(corner, position) === distance(sortedCorners[0], position));
    return closestCorners;
  },
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
    const { getClosestPathablePositions } = MapResourceService;
    const [startGrid] = getClosestPathablePositions(map, start);
    const [endGrid] = getClosestPathablePositions(map, end);
    let force = false;
    start = startGrid || start;
    end = endGrid || end;
    const startAndEndAreEqual = areEqual(start, end);
    if (startAndEndAreEqual) {
      return [];
    } else {
      let mapPath = map.path(start, end);
      mapPath = mapPath.length === 0 ? map.path(endGrid, startGrid) : mapPath;
      if (mapPath.length > 0) {
        const pathCoordinates = getPathCoordinates(mapPath);
        const foundNonPathable = pathCoordinates.some(coordinate => !map.isPathable(coordinate));
        if (foundNonPathable) {
          force = true;
          mapPath = map.path(startGrid, endGrid, { force });
          mapPath = mapPath.length === 0 ? map.path(endGrid, startGrid, { force }) : mapPath;
        }
      }
      return mapPath;
    }
  },
  /**
   * @param {MapResource} map
   * @param {Point2D} position 
   * @return {Point2D[]}
   */
  getPathablePositions: (map, position) => {
    let pathablePositions = [];
    let radius = 0;
    const closestPathablePositions = MapResourceService.getClosestPathablePositions(map, position);
    pathablePositions.push(...closestPathablePositions);
    while (pathablePositions.length === 0) {
      getGridsInCircleWithinMap
      pathablePositions = getGridsInCircleWithinMap(map, position, radius).filter(grid => map.isPathable(grid));
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