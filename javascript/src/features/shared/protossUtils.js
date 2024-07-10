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
  // Retrieve the unit type data from the world context
  const unitTypeData = getUnitTypeData(world, unitType);

  // Return false immediately if the unit is not Protoss
  if (unitTypeData.race !== Race.PROTOSS) {
    return false;
  }

  // Define a set of Protoss units that do not require Pylon power
  const noPylonRequired = new Set([
    UnitType.NEXUS,
    UnitType.ASSIMILATOR,
    UnitType.PYLON,
    // Add other Protoss units that do not require Pylon power if needed
  ]);

  // Return false if the unit is in the noPylonRequired set, otherwise true
  return !noPylonRequired.has(unitType);
}

module.exports = {
  requiresPylonPower,
};
