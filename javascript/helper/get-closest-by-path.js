//@ts-check
"use strict"

function getClosestByPath(map, pos, units, n = 1) {
  // return units.map(unit => ({ unit, distance: distance(pos, unit.pos) }))
  return units.map(unit => ({ unit, distance: map.path(pos, unit.pos).length }))
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
}

module.exports = getClosestByPath;