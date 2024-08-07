// src/units/management/unitTrainingUtils.js

const { getPendingOrders } = require("../../sharedServices");

/**
 * Determines if a unit (base or larva) can initiate training a unit.
 * @param {Unit} unit - The unit (base or larva) to check.
 * @param {number} abilityId - The ability ID required to train the unit.
 * @returns {boolean} - True if the unit can initiate training, false otherwise.
 */
function canInitiateTraining(unit, abilityId) {
  const pendingOrders = getPendingOrders(unit);
  const isAlreadyTraining = pendingOrders.some(order => order.abilityId === abilityId);
  return unit.isIdle() && unit.abilityAvailable(abilityId) && !isAlreadyTraining;
}

/**
 * Determines if a base can initiate training a unit.
 * @param {Unit} base - The base to check.
 * @param {number} abilityId - The ability ID required to train the unit.
 * @returns {boolean} - True if the base can initiate training, false otherwise.
 */
function canBaseInitiateTraining(base, abilityId) {
  return base.isFinished() && canInitiateTraining(base, abilityId);
}

/**
 * Determines if a larva can initiate training a unit.
 * @param {Unit} larva - The larva to check.
 * @param {number} abilityId - The ability ID required to train the unit.
 * @returns {boolean} - True if the larva can initiate training, false otherwise.
 */
function canLarvaInitiateTraining(larva, abilityId) {
  return canInitiateTraining(larva, abilityId);
}

module.exports = {
  canBaseInitiateTraining,
  canLarvaInitiateTraining,
};
