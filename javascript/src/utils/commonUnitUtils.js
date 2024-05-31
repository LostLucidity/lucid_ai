// src/core/utils/commonUnitUtils.js

const groupTypes = require("@node-sc2/core/constants/groups");

const { unitTypeTrainingAbilities } = require("../units/management/unitConfig");


/**
 * @param {Unit} unit 
 * @returns {UnitTypeId | null}
 */
function getUnitBeingTrained(unit) {
  // Access the unit's orders, assuming they exist and are structured as an array
  const { orders } = unit;
  if (!orders || orders.length === 0) return null;

  // The training order should be the first order in the list
  const trainingOrder = orders[0];
  const { abilityId } = trainingOrder; if (abilityId === undefined) return null;

  // The target type of the training order should be the unit type being trained
  const unitBeingTrained = unitTypeTrainingAbilities.get(abilityId); if (unitBeingTrained === undefined) return null;

  return unitBeingTrained || null;
}

/**
 * Checks if a structure is lifted.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit is lifted.
 */
function isStructureLifted(unit) {
  return unit.availableAbilities().some(ability => groupTypes.landingAbilities.includes(ability));
}

/**
 * Checks if a structure can lift off.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit can lift off.
 */
function canStructureLiftOff(unit) {
  return unit.availableAbilities().some(ability => groupTypes.liftingAbilities.includes(ability));
}

module.exports = { getUnitBeingTrained, isStructureLifted, canStructureLiftOff };
