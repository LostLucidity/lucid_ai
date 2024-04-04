// Import necessary dependencies
const { unitPendingOrders } = require('../utils/unitOrders');

/**
 * Clears pending orders for all units to ensure they are ready for new commands.
 * @param {Unit[]} units - The units whose pending orders need to be cleared.
 */
function clearAllPendingOrders(units) {
  units.forEach(unit => {
    unitPendingOrders.delete(unit); // Clears pending orders for the given unit
  });
}

// Export the functions to make them available to other parts of your project
module.exports = {
  clearAllPendingOrders,
};
