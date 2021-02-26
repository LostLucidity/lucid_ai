//@ts-check
"use strict"

module.exports = {
  getMineralFieldTarget: (units, unit) => {
    const [ closestMineralField ] = units.getClosest(unit.pos, units.getMineralFields());
    return closestMineralField;
  }
}