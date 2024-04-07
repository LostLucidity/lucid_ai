// src/utils/sharedUnitOperations.js

// eslint-disable-next-line no-unused-vars
const { UnitType } = require("@node-sc2/core/constants");
// eslint-disable-next-line no-unused-vars
const { Alliance } = require("@node-sc2/core/constants/enums");

/**
 * Determines if a unit is potentially a combatant.
 * @param {Unit} unit - Unit to check.
 * @returns {boolean} - True if unit has potential for combat, otherwise false.
 */
function potentialCombatants(unit) {
  return unit.isCombatUnit() || unit.unitType === UnitType.QUEEN || (unit.isWorker() && !unit.isHarvesting());
}

module.exports = {
  potentialCombatants,
};
