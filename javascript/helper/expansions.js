//@ts-check
"use strict"

const { townhallTypes } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  getAvailableExpansions: (resources) => {
    const {
      map,
      units
    } = resources.get();
    // get Expansion and filter by bases near townhall position.
    const allbases = units.getById(townhallTypes);
    const availableExpansions = map.getExpansions().filter(expansion => {
      const [ closestBase ] = units.getClosest(expansion.townhallPosition, allbases);
      if (closestBase) {
        return distance(expansion.townhallPosition, closestBase.pos) > 1;
      }
    });
    return availableExpansions;
  },
  getBase: (resources, expansion) => {
    const {
      units
    } = resources.get();
    // get closest base that is
    const bases = units.getBases();
    const [ closestBase ] = units.getClosest(expansion.townhallPosition, bases);
    return closestBase;
  },
  getOccupiedExpansions: (resources) => {
    const {
      map,
      units
    } = resources.get();
    // get Expansion and filter by bases near townhall position.
    const bases = units.getBases();
    const occupiedExpansions = map.getExpansions().filter(expansion => {
      const [ closestBase ] = units.getClosest(expansion.townhallPosition, bases);
      if (closestBase) {
        return distance(expansion.townhallPosition, closestBase.pos) < 1;
      }
    });
    return occupiedExpansions;
  }
}