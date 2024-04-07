//@ts-check
"use strict";

const { canUnitBuildAddOn } = require("../utils/training/unitConfig");

/**
 * Get units that are capable to add an add-on (either they don't have one or they have one but can add another).
 * @param {Unit[]} units 
 * @returns {Unit[]}
 */
function getUnitsCapableToAddOn(units) {
  return units.filter(unit => unit.unitType && canUnitBuildAddOn(unit.unitType));
}

module.exports = {
  getUnitsCapableToAddOn,
};
