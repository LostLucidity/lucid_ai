/** @type {Map<number, { units: Unit[], timestamp: number }>} */
const productionUnitsCache = new Map();
const CACHE_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * Retrieves units capable of producing a specific unit type.
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getProductionUnits(world, unitTypeId) {
  const { units } = world.resources.get();
  const now = Date.now();

  const cacheEntry = productionUnitsCache.get(unitTypeId);
  if (cacheEntry && (now - cacheEntry.timestamp) < CACHE_EXPIRATION_MS) {
    return cacheEntry.units;
  }

  if (cacheEntry) {
    productionUnitsCache.delete(unitTypeId);
  }

  const { abilityId } = world.data.getUnitTypeData(unitTypeId);
  if (abilityId === undefined) return [];

  let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);
  if (producerUnitTypeIds.length <= 0) {
    const alias = world.data.getAbilityData(abilityId).remapsToAbilityId;
    if (alias === undefined) return [];
    producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
  }

  const result = units.getByType(producerUnitTypeIds);

  productionUnitsCache.set(unitTypeId, { units: result, timestamp: now });
  return result;
}

module.exports = {
  getProductionUnits,
  productionUnitsCache,
};
