// trainingUtils.js

const { addEarmark } = require("../../core/common/EarmarkManager");
const { checkUnitCount } = require("../../gameLogic/resources/stateManagement");

/**
 * Determines if a unit can be trained based on the target count.
 * @param {World} world The current game world.
 * @param {number} unitTypeId Type of the unit.
 * @param {number | null} targetCount Target number of units.
 * @returns {boolean}
 */
function canTrainUnit(world, unitTypeId, targetCount) {
  return targetCount === null || checkUnitCount(world, unitTypeId, targetCount);
}

/**
 * Earmark resources if needed.
 *
 * @param {World} world
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 * @param {number | boolean | null} earmarkNeeded
 * @returns {boolean}
 */
function earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded) {
  const earmarkNeededBool = Boolean(earmarkNeeded);

  if (earmarkNeededBool) {
    addEarmark(world.data, unitTypeData);
  }

  return !earmarkNeededBool;
}

module.exports = {
  canTrainUnit,
  earmarkResourcesIfNeeded,
};
