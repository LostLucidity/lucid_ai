//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, areEqual, getNeighbors, createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const location = require("../helper/location");
const { pointsOverlap } = require("../helper/utilities");
const { getPathCoordinates } = require("./path-service");
const { getDistance } = require("./position-service");

const MapResourceService = {
  creepEdges: [],
  /** @type {Map<string, Unit[]>} */
  freeGasGeysersCache: new Map(),
  /** @type {Map<string, number[][]>} */
  pathCache: new Map(),
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
    ].filter((grid, index, self) => {
      const mapSize = map.getSize();
      const mapEdge = { x: mapSize.x, y: mapSize.y };
      if (grid.x === mapEdge.x || grid.y === mapEdge.y) return false;
      return self.findIndex(g => areEqual(g, grid)) === index;
    });
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
   * @returns {Unit[]}
   */
  getFreeGasGeysers: (map) => {
    const { freeGasGeysersCache } = MapResourceService;
    // check if free gas geysers have already been calculated
    if (!freeGasGeysersCache.has('freeGasGeysers')) {
      freeGasGeysersCache.set('freeGasGeysers', map.freeGasGeysers());
    }
    return freeGasGeysersCache.get('freeGasGeysers') || [];
  },
  /**
   * @param {MapResource} map
   * @param {Point2D} start
   * @param {Point2D} end
   * @returns {number[][]}
   */
  getMapPath: (map, start, end) => {
    const { pathCache, getClosestPathablePositions } = MapResourceService;
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

    const mapPath = map.path(start, end);
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
  },
  /**
   * @param {MapResource} map 
   * @param {string} targetLocationFunction
   * @returns 
   */
  getTargetLocation: (map, targetLocationFunction) => {
    return (map[targetLocationFunction] && map[targetLocationFunction]()) ? map[targetLocationFunction]().centroid : location[targetLocationFunction](map);
  },
  /**
   * 
   * @param {MapResource} map 
   * @param {Point2D} position 
   * @returns {Boolean}
   */
  isCreep: (map, position) => {
    const { x, y } = position;
    if (x === undefined || y === undefined) return false;
    const grid = { x: Math.floor(x), y: Math.floor(y) };
    return map.getCreep().some(creep => areEqual(creep, grid));
  },
  /**
   * 
   * @param {MapResource} map 
   * @param {Point2D} pos 
   * @returns {Boolean}
   */
  isCreepEdge: (map, pos) => {
    const isCreep = MapResourceService.isCreep(map, pos);
    if (!isCreep) return false;
    const { x, y } = pos; if (x === undefined || y === undefined) return false;
    // Directly calculating the neighbor positions without creating an array.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        // Skip the center point
        if (dx === 0 && dy === 0) continue;

        const neighbor = { x: x + dx, y: y + dy };
        
        // Check the condition and return early if satisfied
        if (!map.hasCreep(neighbor) && map.isPathable(neighbor)) {
          return true;
        }
      }
    }
    return false;
  },
  /**
   * @param {MapResource} map
   * @param {Point2D} position
   * @returns {boolean}
   */
  isGeyserFree: (map, position) => {
    return MapResourceService.getFreeGasGeysers(map).some(geyser => geyser.pos && areEqual(geyser.pos, position));
  },
  /**
   * @param {MapResource} map 
   * @param {Point2D} pos
   * @returns {boolean}
   */
  isInMineralLine: (map, pos) => {
    const point = createPoint2D(pos);
    const closestExpansion = map.getClosestExpansion(point);
    const { areas } = closestExpansion; if (areas === undefined) return false;
    const { mineralLine } = areas; if (mineralLine === undefined) return false;
    return pointsOverlap([point], mineralLine);
  },
  /**
   * @param {MapResource} map 
   * @param {UnitTypeId} unitType
   * @param {Point2D} position
   * @returns {boolean}
   */
  isPlaceableAtGasGeyser: (map, unitType, position) => {
    return gasMineTypes.includes(unitType) && map.freeGasGeysers().some(gasGeyser => gasGeyser.pos && getDistance(gasGeyser.pos, position) <= 1);
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