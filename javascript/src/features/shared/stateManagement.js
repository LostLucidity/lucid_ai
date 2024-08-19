// src/utils/gameLogic/stateManagement.js
// Import necessary dependencies
const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");

const { getDistance } = require("./pathfinding/spatialCoreUtils");
const { getTimeInSeconds } = require("./timeUtils");
const { missingUnits } = require("../../../data/gameData/gameDataStore");
const { calculateTimeToKillUnits } = require("../../core/sharedUtils");
const { GameState } = require("../../state");
const { getWeaponDPS } = require("../../units");

/**
 * Calculates the remaining time to finish a structure's construction.
 * @param {DataStorage} data - The game data storage.
 * @param {Unit} unit - The unit representing the structure.
 * @returns {number} Time left in seconds
 */
function calculateTimeToFinishStructure(data, unit) {
  if (typeof unit.unitType !== 'number' || typeof unit.buildProgress !== 'number') return 0;

  const { buildTime } = data.getUnitTypeData(unit.unitType);
  if (typeof buildTime !== 'number') return 0;

  const timeElapsed = buildTime * unit.buildProgress;
  return getTimeInSeconds(buildTime - timeElapsed);
}

/**
 * Analyzes the game state and determines if the current count of a 
 * specific unit type matches the target count based on the provided comparison mode.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The unit type ID to check.
 * @param {number} targetCount - The target count of the unit type.
 * @param {boolean} [checkAtLeast=false] - If true, checks if the count is at least the target count. Otherwise, checks if it is less than the target count.
 * @returns {boolean}
 */
function checkUnitCount(world, unitType, targetCount, checkAtLeast = false) {
  if (!world || typeof unitType === 'undefined' || typeof targetCount !== 'number') {
    throw new Error('Invalid parameters');
  }

  const gameState = GameState.getInstance();
  const unitsCount = gameState.getUnitTypeCount(world, unitType);
  const missingUnitCount = missingUnits ? missingUnits.filter(unit => unit.unitType === unitType).length : 0;
  const totalUnitCount = unitsCount + missingUnitCount;

  const adjustedTargetCount = getAdjustedTargetCount(unitType, unitsCount, targetCount);

  return checkAtLeast ? totalUnitCount >= adjustedTargetCount : totalUnitCount < adjustedTargetCount;
}

/**
 * Determines the bot's race, defaulting to Terran if undefined.
 * @param {World} world - The game world context.
 * @returns {SC2APIProtocol.Race} The determined race of the bot.
 */
function determineBotRace(world) {
  return world.agent.race || Race.TERRAN;
}

/**
 * Calculates the adjusted target count for specific unit types.
 * @param {UnitTypeId} unitType - The unit type ID.
 * @param {number} unitsCount - The current count of the unit type.
 * @param {number} targetCount - The target count of the unit type.
 * @returns {number} The adjusted target count
 */
function getAdjustedTargetCount(unitType, unitsCount, targetCount) {
  return unitType === UnitType.ZERGLING ? targetCount + (unitsCount % 2) : targetCount;
}

/**
 * Determines if a townhall is in danger based on nearby enemy units.
 * @param {World} world - The current world context.
 * @param {Unit} townhall - The townhall unit.
 * @param {Unit[]} nearbyEnemies - Array of nearby enemy units.
 * @returns {boolean} - True if townhall is in danger, otherwise false.
 */
function isTownhallInDanger(world, townhall, nearbyEnemies) {
  const selfDefenseUnits = world.resources.get().units.getCombatUnits().filter(unit => {
    const distance = getDistance(unit.pos, townhall.pos);
    return distance !== undefined && distance < 10; // 10 units radius for defense
  });

  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfDefenseUnits, nearbyEnemies, getWeaponDPS);
  return timeToBeKilled <= timeToKill;
}

module.exports = {
  calculateTimeToFinishStructure,
  checkUnitCount,
  determineBotRace,
  getAdjustedTargetCount,
  isTownhallInDanger,
};
