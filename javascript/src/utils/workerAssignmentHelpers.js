// workerAssignmentHelpers.js
// This module contains shared helper functions for worker assignment and management.

const groupTypes = require("@node-sc2/core/constants/groups");

/**
 * Determines if a unit has pending construction orders.
 * @param {Unit & { pendingOrders?: SC2APIProtocol.UnitOrder[] }} unit - The unit to check.
 * @returns {boolean}
 */
function isPendingContructing(unit) {
  // Safely check if 'pendingOrders' exists and is an array before proceeding
  return Array.isArray(unit.pendingOrders) && unit.pendingOrders.some(o => {
    // Ensure that o.abilityId is defined and is a number before using it in the includes check
    return typeof o.abilityId === 'number' && groupTypes.constructionAbilities.includes(o.abilityId);
  });
}

// Exporting the functions
module.exports = {
  isPendingContructing,
};
