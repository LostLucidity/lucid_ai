//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  getBase: (resources, expansion) => {
    const {
      units
    } = resources.get();
    // get closest base that is
    const bases = units.getBases();
    const [ closestBase ] = units.getClosest(expansion.townhallPosition, bases);
    return closestBase;
  },
}