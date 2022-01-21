//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");

const MapResourceService = {
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