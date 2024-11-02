const { Upgrade } = require('@node-sc2/core/constants');

/**
 * Creates a mapping of abilityId to upgradeId for quick lookup.
 * @param {DataStorage} data - Game data storage instance for retrieving upgrade data.
 * @returns {{ [abilityId: number]: number }} - A mapping from abilityId to upgradeId.
 */
function createUpgradeAbilitiesMap(data) {
  /** @type {{ [abilityId: number]: number }} */
  const upgradeAbilities = {};
  Object.values(Upgrade).forEach(upgradeId => {
    const upgradeData = data.getUpgradeData(upgradeId);
    if (upgradeData && upgradeData.abilityId !== undefined) {
      upgradeAbilities[upgradeData.abilityId] = upgradeId;
    }
  });
  return upgradeAbilities;
}

module.exports = { createUpgradeAbilitiesMap };
