// gameStateHelpers.js

const { Race } = require("@node-sc2/core/constants/enums");

const { getDistance } = require("../geometryUtils");
const { calculateTimeToKillUnits } = require("../unitHelpers");

/**
 * Determines the bot's race, defaulting to Terran if undefined.
 * @param {World} world - The game world context.
 * @returns {SC2APIProtocol.Race} The determined race of the bot.
 */
function determineBotRace(world) {
  return world.agent.race || Race.TERRAN;
}

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
  determineBotRace,
  isTownhallInDanger,
};
