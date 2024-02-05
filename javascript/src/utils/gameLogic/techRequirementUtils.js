// techRequirementUtils.js

const { UnitType } = require("@node-sc2/core/constants");

const { getById } = require("../common/gameUtils");

/**
 * Check tech requirements for a given unit.
 * @param {ResourceManager} resources The game's resource manager.
 * @param {number} techRequirement The technology requirement to check.
 * @param {Unit} unit The unit to check the requirement for.
 * @returns {boolean} True if the tech requirement is fulfilled, false otherwise.
 */
function checkTechRequirement(resources, techRequirement, unit) {
  if (techRequirement === UnitType.TECHLAB) {
    return unit.hasTechLab();
  }
  return getById(resources, [techRequirement]).some(resourceUnit =>
    resourceUnit.buildProgress !== undefined && resourceUnit.buildProgress >= 1
  );
}

// You can add more technology-related utility functions here as needed.

module.exports = {
  checkTechRequirement,
  // Export other technology-related utilities here.
};
