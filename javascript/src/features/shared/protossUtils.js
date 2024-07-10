const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");

const { getUnitTypeData } = require("../../core/gameData");

/**
 * Checks if the given unit type requires Pylon power.
 * @param {number} unitType The type of the unit.
 * @param {World} world The game world context.
 * @returns {boolean} True if the unit requires Pylon power, false otherwise.
 */
function requiresPylonPower(unitType, world) {
  const unitTypeData = getUnitTypeData(world, unitType);

  // Check if the unit belongs to Protoss race
  if (unitTypeData.race !== Race.PROTOSS) {
    return false;
  }

  // Define Protoss units that do not require Pylon power
  const noPylonRequired = [
    UnitType.NEXUS,
    UnitType.ASSIMILATOR,
    UnitType.PYLON,
    // Add other Protoss units that do not require Pylon power if needed
  ];

  return !noPylonRequired.includes(unitType);
}

module.exports = {
  requiresPylonPower,
};
