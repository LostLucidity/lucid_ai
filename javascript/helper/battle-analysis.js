//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point")

module.exports = {
  calculateNearSupply: (data, units) => {
    return units.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
  },
  getInRangeUnits: (unit, targetUnits) => {
    return targetUnits.filter(targetUnit => distance(unit.pos, targetUnit.pos) < 16);
  }
}