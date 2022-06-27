//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");

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
    let positions = []
    let radius = 1
    do {
      positions = gridsInCircle(structure.pos, radius).filter(position => map.isPathable(position));
      radius++
    } while (positions.length === 0);
    return positions;
  }
}

module.exports = MapResourceService;