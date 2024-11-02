const { UnitType, WarpUnitAbility } = require('@node-sc2/core/constants');

/**
 * Creates a mapping of abilityId to unitTypeId for training abilities.
 * @param {DataStorage} data - Game data storage instance for retrieving unit type data.
 * @returns {{ [abilityId: number]: number }} - A mapping from abilityId to unitTypeId.
 */
function createUnitTypeTrainingAbilitiesMap(data) {
  const unitTypeTrainingAbilities = new Map();

  Object.values(UnitType).forEach(unitTypeId => {
    const unitData = data.getUnitTypeData(unitTypeId);
    if (unitData?.abilityId) {
      unitTypeTrainingAbilities.set(unitData.abilityId, unitTypeId);
    }
    if (WarpUnitAbility[unitTypeId]) {
      unitTypeTrainingAbilities.set(WarpUnitAbility[unitTypeId], unitTypeId);
    }
  });

  const trainingAbilitiesObject = Object.fromEntries(unitTypeTrainingAbilities);
  return trainingAbilitiesObject;
}

module.exports = { createUnitTypeTrainingAbilitiesMap };