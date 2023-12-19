// gameStateHelpers.js

const { getDistance } = require("../geometryUtils");
const { calculateTimeToKillUnits } = require("../unitHelpers");

/**
 * Determines if a townhall is in danger based on nearby enemy units.
 * @param {World} world - The current world context.
 * @param {Unit} townhall - The townhall unit.
 * @param {Unit[]} nearbyEnemies - Array of nearby enemy units.
 * @returns {boolean} - True if townhall is in danger, otherwise false.
 */
function isTownhallInDanger(world, townhall, nearbyEnemies) {
  // Retrieve self-defense units near the townhall
  const selfDefenseUnits = world.resources.get().units.getCombatUnits().filter(unit => {
    const distance = getDistance(unit.pos, townhall.pos);
    return distance !== undefined && distance < 10; // 10 units radius for defense
  });

  // Calculate time to kill and time to be killed
  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfDefenseUnits, nearbyEnemies);

  // Townhall is in danger if it can be killed faster than the threats can be eliminated
  return timeToBeKilled <= timeToKill;
}

module.exports = {
  isTownhallInDanger,
  // Export other functions as they are added
};
