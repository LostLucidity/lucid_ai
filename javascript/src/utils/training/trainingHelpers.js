/**
 * Retrieves units capable of producing a specific unit type, without relying on cached data.
 * This function is a simplified version meant to reduce dependencies and avoid circular references.
 * @param {World} world The game world context, containing all necessary game state information.
 * @param {UnitTypeId} unitTypeId The specific type of unit to find production capabilities for.
 * @returns {Unit[]} An array of units capable of producing the specified unit type.
 */
function getBasicProductionUnits(world, unitTypeId) {
  const { units } = world.resources.get(); // Access the current state of units from the world context.

  const unitTypeData = world.data.getUnitTypeData(unitTypeId);
  if (!unitTypeData || unitTypeData.abilityId === undefined) {
    // If there's no data for the unit type or no associated ability ID, return an empty array.
    return [];
  }

  // Find all unit types that have the ability to produce the specified unit type.
  let producerUnitTypeIds = world.data.findUnitTypesWithAbility(unitTypeData.abilityId);

  if (producerUnitTypeIds.length === 0 && unitTypeData.abilityId) {
    // If no direct producers are found, check for any aliases of the ability that might be used by other units to produce the specified unit type.
    const alias = world.data.getAbilityData(unitTypeData.abilityId).remapsToAbilityId;
    if (alias) {
      producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
    }
  }

  // Retrieve all units of the types capable of producing the specified unit type.
  const productionUnits = units.getByType(producerUnitTypeIds);

  return productionUnits;
}

module.exports = {
  getBasicProductionUnits,
};
