//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");

const getClosest = {
  getClosestPosition: (position, locations, n = 1) => {
    return locations.map(location => ({ location, distance: distance(position, location) }))
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.location)
      .slice(0, n);
  }
}

module.exports = getClosest;