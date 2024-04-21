//@ts-check
"use strict"

const { unitPendingOrders } = require("./utils/unitManagement/unitOrders");

// Shared data structures
/** @type {Map<string, number>} */
let foodEarmarks = new Map();

/**
 * Retrieves pending orders for a unit.
 * @param {Unit} unit - The unit to retrieve pending orders for.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of pending orders.
 */
function getPendingOrders(unit) {
  return unitPendingOrders.get(unit) || [];
}

// Export the shared data and functions
module.exports = {
  foodEarmarks,
  getPendingOrders,
};
