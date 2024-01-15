//@ts-check
"use strict";

// Import necessary modules or constants
const { gasMineTypes } = require('@node-sc2/core/constants/groups');
const groupTypes = require('@node-sc2/core/constants/groups');

const { getTimeInSeconds, positionIsEqual } = require('../utils');

/**
 * Calculates the remaining time to finish a structure's construction.
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @returns {number} Time left in seconds
 */
function calculateTimeToFinishStructure(data, unit) {
  // Check if unitType is defined
  if (typeof unit.unitType === 'number') {
    const { buildTime } = data.getUnitTypeData(unit.unitType);
    // Check if both buildTime and buildProgress are defined
    if (typeof buildTime === 'number' && typeof unit.buildProgress === 'number') {
      const timeElapsed = buildTime * unit.buildProgress;
      const timeLeft = getTimeInSeconds(buildTime - timeElapsed);
      return timeLeft;
    }
  }
  return 0; // Return 0 if unitType, buildTime, or buildProgress is undefined
}

/**
 * Helper function to determine if a unitType is a gas collector
 * @param {number} unitType - The unit type ID to check
 * @returns {boolean} - Returns true if the unit type is a gas collector, false otherwise
 */
function isGasCollector(unitType) {
  return gasMineTypes.includes(unitType);
}

/**
 * Determines if the geyser at the given position is unoccupied.
 * @param {World} world - The game world state.
 * @param {Point2D} position - The position to check for an unoccupied geyser.
 * @returns {boolean} - Returns true if the geyser is free, false otherwise.
 */
function isGeyserFree(world, position) {
  // Retrieve all gas collectors on the map from 'world'
  const gasCollectors = world.resources.get().units.getByType(groupTypes.gasMineTypes);

  // Check if any gas collector is at 'position'
  for (const collector of gasCollectors) {
    // Ensure collector position is defined before comparing
    if (collector.pos && positionIsEqual(collector.pos, position)) {
      return false; // There's a gas collector at 'position'
    }
  }

  // If no gas collector is found at 'position', the geyser is free
  return true;
}

module.exports = {
  calculateTimeToFinishStructure,
  isGasCollector,
  isGeyserFree,
};
