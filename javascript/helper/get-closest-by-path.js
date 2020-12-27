//@ts-check
"use strict"

const { add } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  distanceByPath: (map, position, point) => {
    return map.path(position, point).length
  },
  getClosestPositionByPath: (map, position, points, n = 1) => {
    return points.map(point => ({ point, distance: module.exports.distanceByPath(map, position, point) }))
      .filter(pointObject => pointObject.distance > 0)
      .sort((a, b) => a.distance - b.distance)
      .map(pointObject => pointObject.point)
      .slice(0, n);
  },
  getClosestUnitByPath: (map, position, units, n = 1) => {
    return units.map(unit => ({ unit, distance: module.exports.distanceByPath(map, position, add(unit.pos, unit.radius)) }))
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  }
}