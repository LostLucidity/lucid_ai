// src/core/gameData.js

/**
 * @typedef {Object} Resources
 * @property {number} foodUsed - The amount of food used.
 */
const defaultResources = {
  foodUsed: 0,
};

/**
 * Finds unit types that have a specific ability.
 * @param {World} world - The game world context.
 * @param {number} abilityId - The ability ID to search for.
 * @returns {Array<number>} An array of unit types that can perform the specified ability.
 */
function findUnitTypesWithAbility(world, abilityId) {
  return world.data.findUnitTypesWithAbility(abilityId);
}

/**
 * Retrieves data for a specific unit type.
 * @param {World} world - The game world context.
 * @param {number} unitTypeId - The ID of the unit type.
 * @returns {SC2APIProtocol.UnitTypeData} Data about the specified unit type.
 */
function getUnitTypeData(world, unitTypeId) {
  return world.data.getUnitTypeData(unitTypeId);
}

// Export the shared data and functions
module.exports = {
  defaultResources,
  findUnitTypesWithAbility,
  getUnitTypeData,
};
