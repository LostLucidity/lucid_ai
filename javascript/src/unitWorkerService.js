// unitWorkerService.js

/**
 * Shared service for worker and unit management.
 */

// Import necessary dependencies
const GameState = require('./gameState');

/**
 * Retrieves units that are currently training a specific unit type.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The unit type to check for.
 * @returns {Unit[]} - Array of units training the specified unit type.
 */
function getUnitsTrainingTargetUnitType(world, unitType) {
  const { data, resources } = world;
  const unitsResource = resources.get().units;
  let { abilityId } = data.getUnitTypeData(unitType);
  if (abilityId === undefined) return [];

  // Retrieve the array of units from the UnitResource object
  const unitArray = unitsResource.getAll(); // Assuming 'getAll()' is the method to get unit array from UnitResource

  return GameState.getInstance().getUnitsWithCurrentOrders(unitArray, [abilityId]);
}


// Add other shared functions and data here as needed.

module.exports = {
  getUnitsTrainingTargetUnitType,
};
