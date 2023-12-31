const { UnitType } = require("@node-sc2/core/constants");

/**
 * Checks if the given Protoss unit type requires Pylon power.
 * @param {UnitTypeId} unitType The type of the Protoss unit.
 * @returns {boolean} True if the unit requires Pylon power, false otherwise.
 */
function requiresPylonPower(unitType) {
  const noPylonRequired = [UnitType.NEXUS, UnitType.ASSIMILATOR, UnitType.PYLON];
  return !noPylonRequired.includes(unitType);
}

module.exports = {
  requiresPylonPower,
};
