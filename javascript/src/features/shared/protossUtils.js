const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const { getUnitTypeData } = require("../../core/gameData");
const { calculateDistance } = require("../../utils/coreUtils");

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

/**
 * Checks whether every cell in a structure's footprint is covered by a power source.
 * @param {number} unitType The structure type to check.
 * @param {Point2D} position The intended structure position.
 * @param {SC2APIProtocol.PowerSource[]} powerSources Known or projected power sources.
 * @returns {boolean} True when the complete footprint is powered.
 */
function isStructurePowered(unitType, position, powerSources) {
  const footprint = getFootprint(unitType);
  if (!footprint || !position || !Array.isArray(powerSources)) return false;

  const footprintCells = cellsInFootprint(position, footprint);
  if (footprintCells.length === 0) return false;

  return footprintCells.every(cell => powerSources.some(powerSource => {
    if (!powerSource.pos || powerSource.radius === undefined) return false;
    return calculateDistance(powerSource.pos, cell) <= powerSource.radius;
  }));
}

module.exports = {
  isStructurePowered,
  requiresPylonPower,
};
