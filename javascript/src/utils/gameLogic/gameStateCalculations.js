// utils/gameStateCalculations.js

const { getTimeInSeconds } = require("../../utils");

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

module.exports = { calculateTimeToFinishStructure };
