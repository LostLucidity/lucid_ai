// src/unitOrders.js
/**
 * @type {WeakMap<Unit, SC2APIProtocol.ActionRawUnitCommand[]>}
 */
const unitPendingOrders = new WeakMap();

/**
 * Sets pending orders for a unit.
 * @param {Unit} unit 
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @returns {void}
 */
function setPendingOrders(unit, unitCommand) {
  const orders = unitPendingOrders.get(unit) || [];
  orders.push(unitCommand);
  unitPendingOrders.set(unit, orders);
}

module.exports = {
  unitPendingOrders,
  setPendingOrders,
};
