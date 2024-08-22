const EarmarkManager = require("../../core/earmarkManager");
const { checkUnitCount } = require("../../utils/stateManagement");

/**
 * Determines if a unit can be trained based on the target count.
 * @param {World} world - The current game world.
 * @param {number} unitTypeId - Type of the unit.
 * @param {number | null} targetCount - Target number of units.
 * @returns {boolean} - True if the unit can be trained, otherwise false.
 */
function canTrainUnit(world, unitTypeId, targetCount) {
  return targetCount === null || checkUnitCount(world, unitTypeId, targetCount, false);
}

/**
 * Earmarks resources if needed.
 * @param {World} world - The current game world.
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData - Data of the unit type to earmark.
 * @param {number | boolean | null} earmarkNeeded - Flag indicating if earmarking is needed.
 * @returns {boolean} - True if no earmarking was needed, otherwise false.
 */
function earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded) {
  if (earmarkNeeded) {
    EarmarkManager.getInstance().addEarmark(world.data, unitTypeData);
    return false;
  }
  return true;
}

module.exports = {
  canTrainUnit,
  earmarkResourcesIfNeeded,
};
