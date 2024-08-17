//@ts-check
"use strict";

const { canUnitBuildAddOn } = require("../units/management/unitConfig");


/**
 * Retrieves units capable of adding an add-on. This includes units that currently do not have an add-on
 * or those that can potentially add another.
 * @param {Unit[]} units - Array of unit objects to evaluate.
 * @returns {Unit[]} - Array of units capable of adding an add-on.
 */
function getUnitsCapableToAddOn(units) {
  if (!Array.isArray(units)) {
    throw new TypeError("Expected an array of units");
  }

  return units.filter(unit => unit.unitType && canUnitBuildAddOn(unit.unitType));
}

module.exports = {
  getUnitsCapableToAddOn,
};
