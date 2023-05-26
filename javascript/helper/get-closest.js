//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");

const getClosest = {
  /**
   * 
   * @param {Point2D} position 
   * @param {Point2D[]} locations 
   * @param {number} n 
   * @returns {Point2D[]}
   */
  getClosestPosition: (position, locations, n = 1) => {
    let sortedLocations = locations.map(location => ({ location, distance: distance(position, location) }));
    sortedLocations.sort((a, b) => a.distance - b.distance);
    return sortedLocations.slice(0, n).map(u => u.location);
  }
}

module.exports = getClosest;