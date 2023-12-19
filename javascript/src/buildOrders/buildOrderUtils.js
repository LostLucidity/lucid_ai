"use strict";


// Import necessary modules or dependencies
const { UnitType } = require("@node-sc2/core/constants");

/**
 * Dynamically interprets build order actions, directly converting action strings to UnitType references.
 * @param {string} action - The action string from the build order.
 * @returns {{unitType: number, count: number, isUpgrade: boolean, isChronoBoosted: boolean}}
 */
function interpretBuildOrderAction(action) {
  const formattedAction = action.split(' ')[0].toUpperCase().replace(/\s+/g, '_');

  let unitType;

  if (formattedAction in UnitType) {
    // Type assertion to bypass TypeScript error
    unitType = UnitType[/** @type {keyof typeof UnitType} */ (formattedAction)];
  } else {
    unitType = UnitType.INVALID;
  }

  const countMatch = action.match(/\sx(\d+)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 1;

  const isUpgrade = action.includes("Level") || action.includes("Thermal Lance") || action.includes("Charge");
  const isChronoBoosted = action.includes("Chrono Boost");

  return { unitType, count, isUpgrade, isChronoBoosted };
}

// Export the utility functions
module.exports = {
  interpretBuildOrderAction,
};
