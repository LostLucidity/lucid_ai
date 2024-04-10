//@ts-check
"use strict";

const { addEarmark } = require("../../features/construction/resourceManagement");

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
  earmarkResourcesIfNeeded,
};
