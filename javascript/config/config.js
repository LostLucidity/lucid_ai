require('dotenv').config();
const { Difficulty, Race } = require('@node-sc2/core/constants/enums');
const maps = require('./maps');

// Default configuration values
const DEFAULTS = {
  RACE: Race.RANDOM,
  DIFFICULTY: Difficulty.EASY,
  MAP: maps.MAP_JAGANNATHA_LE,
  LOGGING_LEVEL: 1,
  PLAN_MAX: {
    supply: 200,
    gasMine: 2,
  },
  AUTOMATE_SUPPLY: true,
  NATURAL_WALL_PYLON: true,
  MAX_TOWN_HALLS: 3,
  TOWN_HALL_COST: 400,
};

// Initialize averageGatheringTime with a default value
let averageGatheringTime = 4;  // Merged from config.json or environment variables

/**
 * Get the current average gathering time.
 * @returns {number} The current average gathering time.
 */
function getAverageGatheringTime() {
  return averageGatheringTime;
}

/**
 * Set a new average gathering time.
 * @param {number} newAverage The new average gathering time to set.
 */
function setAverageGatheringTime(newAverage) {
  averageGatheringTime = newAverage;
}

/**
 * @param {number} level
 */
function getValidatedLoggingLevel(level) {
  const validLevels = [0, 1, 2];
  return validLevels.includes(level) ? level : DEFAULTS.LOGGING_LEVEL;
}

// Function to convert race name to its enum value
/**
 * @param {string | undefined} raceName
 */
function getRaceEnumValue(raceName) {
  switch ((raceName ?? '').toUpperCase()) {
    case 'TERRAN':
      return Race.TERRAN;
    case 'ZERG':
      return Race.ZERG;
    case 'PROTOSS':
      return Race.PROTOSS;
    default:
      return DEFAULTS.RACE;  // Fallback to default race (e.g., Race.RANDOM)
  }
}

module.exports = {
  defaultRace: getRaceEnumValue(process.env.DEFAULT_RACE),
  defaultDifficulty: process.env.DEFAULT_DIFFICULTY || DEFAULTS.DIFFICULTY,
  defaultMap: process.env.DEFAULT_MAP || DEFAULTS.MAP,
  loggingLevel: getValidatedLoggingLevel(parseInt(process.env.LOGGING_LEVEL || '0', 10)),
  planMax: DEFAULTS.PLAN_MAX,
  automateSupply: process.env.AUTOMATE_SUPPLY === 'true' || DEFAULTS.AUTOMATE_SUPPLY,
  naturalWallPylon: process.env.NATURAL_WALL_PYLON === 'true' || DEFAULTS.NATURAL_WALL_PYLON,
  debugBuildOrderKey: process.env.DEBUG_BUILD_ORDER_KEY || null,
  maxTownHalls: DEFAULTS.MAX_TOWN_HALLS,
  townHallCost: DEFAULTS.TOWN_HALL_COST,
  getAverageGatheringTime,
  setAverageGatheringTime,
};
