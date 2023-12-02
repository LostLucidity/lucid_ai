//@ts-check
'use strict';

// Import necessary constants and services from your game's core library
const { UnitType } = require('@node-sc2/core/constants');

/** @type {Map<number, number>} */
const unitTypeTrainingAbilities = new Map();

// Define the flying types mapping
const flyingTypesMapping = new Map([
  [UnitType.COMMANDCENTERFLYING, UnitType.COMMANDCENTER],
  [UnitType.BARRACKSFLYING, UnitType.BARRACKS],
  [UnitType.FACTORYFLYING, UnitType.FACTORY],
  [UnitType.STARPORTFLYING, UnitType.STARPORT],
]);

// Initialize the map for caching movement speeds by unit type
/** @type Map<number, number> */
const movementSpeedByType = new Map();

/**
 * Retrieves the movement speed of a unit based on its type.
 * @param {Unit} unit The unit for which to get the movement speed.
 * @returns {number | undefined} The movement speed of the unit, if available.
 */
const getMovementSpeedByType = (unit) => {
  const { unitType } = unit;
  if (unitType === undefined) return;
  if (!movementSpeedByType.has(unitType)) {
    const { movementSpeed } = unit.data();
    if (movementSpeed === undefined) return;
    movementSpeedByType.set(unitType, movementSpeed);
  }
  return movementSpeedByType.get(unitType);
};

/**
 * Check if a unit type can construct an addon.
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function canUnitBuildAddOn(unitType) {
  const { BARRACKS, FACTORY, STARPORT } = UnitType;
  // Add the unit types that can construct addons here
  const addonConstructingUnits = [
    ...(countTypes.get(BARRACKS) || []), ...(addOnTypesMapping.get(BARRACKS) || []),
    ...(countTypes.get(FACTORY) || []), ...(addOnTypesMapping.get(FACTORY) || []),
    ...(countTypes.get(STARPORT) || []), ...(addOnTypesMapping.get(STARPORT) || []),
  ];
  return addonConstructingUnits.includes(unitType);
}

// Export the mappings, configurations, and functions
module.exports = {
  flyingTypesMapping,
  getMovementSpeedByType,
  unitTypeTrainingAbilities,
  canUnitBuildAddOn,
};
