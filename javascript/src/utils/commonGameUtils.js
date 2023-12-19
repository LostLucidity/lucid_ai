"use strict";

const { unitPendingOrders } = require("../unitOrders");

/**
 * Retrieves pending orders for a unit.
 * @param {Unit} unit - The unit to retrieve pending orders for.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of pending orders.
 */
function getPendingOrders(unit) {
  return unitPendingOrders.get(unit) || [];
}

module.exports = {
  getPendingOrders,
};
