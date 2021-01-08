//@ts-check
"use strict"

const { add } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  distanceByPath: (resources, position, point) => {
    const { map, units } = resources.get();
    position = map.isPlaceable(position) ? position : getUnitCornerPosition(units.getClosest(position, units.getAlive())[0]);
    return map.path(position, point).length
  },
  getClosestPositionByPath: (resources, position, points, n = 1) => {
    return points.map(point => ({ point, distance: module.exports.distanceByPath(resources, position, point) }))
      .filter(pointObject => pointObject.distance > 0)
      .sort((a, b) => a.distance - b.distance)
      .map(pointObject => pointObject.point)
      .slice(0, n);
  },
  getClosestUnitByPath: (resources, position, units, n = 1) => {
    return units.map(unit => ({ unit, distance: module.exports.distanceByPath(resources, add(unit.pos, unit.radius), position) }))
      .filter(pointObject => pointObject.distance > 0)
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  }
}

function getUnitCornerPosition(unit) {
  return add(unit.pos, unit.radius);
}