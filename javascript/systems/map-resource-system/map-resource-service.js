//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, areEqual, createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const location = require("../../helper/location");
const { pointsOverlap } = require("../../helper/utilities");

const MapResourceService = {
  creepEdges: [],
  creepPositionsSet: new Set(),
  /** @type {Map<string, Unit[]>} */
  freeGasGeysersCache: new Map(),

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
   * @param {string} targetLocationFunction
   * @returns 
   */
  getTargetLocation: (map, targetLocationFunction) => {
    return (map[targetLocationFunction] && map[targetLocationFunction]()) ? map[targetLocationFunction]().centroid : location[targetLocationFunction](map);
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
    return pointsOverlap([point], mineralLine, 1.1);
  },
  /**
   * @param {MapResource} map 
   * @param {UnitTypeId} unitType
   * @param {Point2D} position
   * @returns {boolean}
   */
  isPlaceableAtGasGeyser: (map, unitType, position) => {
    return gasMineTypes.includes(unitType) && map.freeGasGeysers().some(gasGeyser => gasGeyser.pos && getDistance(gasGeyser.pos, position) <= 1);
  },
  /**
   * @param {MapResource} map
   * @returns {void}
   */
  updateCreepPositionsSet: (map) => {
    const newCreepPositionsSet = new Set();
    map.getCreep().forEach(creep => {
      const { x, y } = creep; if (x === undefined || y === undefined) return;
      newCreepPositionsSet.add(`${Math.floor(x)}:${Math.floor(y)}`);
    });
    MapResourceService.creepPositionsSet = newCreepPositionsSet;
  }
}

module.exports = MapResourceService;