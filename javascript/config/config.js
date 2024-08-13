require('dotenv').config();
const { Difficulty, Race } = require('@node-sc2/core/constants/enums');
const maps = require('./maps');

// Default configuration values
const DEFAULTS = {
  RACE: Race.RANDOM,
  DIFFICULTY: Difficulty.EASY,
  MAP: maps.MAP_JAGANNATHA_LE,
  LOGGING_LEVEL: 0,  // Set to 0 to capture all logs
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
function validateLoggingLevel(level) {
  const validLevels = [0, 1, 2];
  return validLevels.includes(level) ? level : DEFAULTS.LOGGING_LEVEL;
}

// Mapping object to convert race name to its enum value
const RACE_ENUM_MAP = {
  'TERRAN': Race.TERRAN,
  'ZERG': Race.ZERG,
  'PROTOSS': Race.PROTOSS,
};

// Function to convert race name to its enum value
/**
 * @param {string | undefined} raceName
 */
function getRaceEnumValue(raceName) {
  const normalizedRaceName = (raceName ?? '').toUpperCase();
  return RACE_ENUM_MAP[/** @type {keyof typeof RACE_ENUM_MAP} */ (normalizedRaceName)] || DEFAULTS.RACE;
}

// Change the default logging level from 0 to 1
module.exports = {
  defaultRace: getRaceEnumValue(process.env.DEFAULT_RACE),
  defaultDifficulty: process.env.DEFAULT_DIFFICULTY || DEFAULTS.DIFFICULTY,
  defaultMap: process.env.DEFAULT_MAP || DEFAULTS.MAP,
  loggingLevel: validateLoggingLevel(parseInt(process.env.LOGGING_LEVEL || '1', 10)), // Default to level 1 if undefined
  planMax: DEFAULTS.PLAN_MAX,
  automateSupply: process.env.AUTOMATE_SUPPLY === 'true' || DEFAULTS.AUTOMATE_SUPPLY,
  naturalWallPylon: process.env.NATURAL_WALL_PYLON === 'true' || DEFAULTS.NATURAL_WALL_PYLON,
  debugBuildOrderKey: process.env.DEBUG_BUILD_ORDER_KEY || null,
  maxTownHalls: DEFAULTS.MAX_TOWN_HALLS,
  townHallCost: DEFAULTS.TOWN_HALL_COST,
  getAverageGatheringTime,
  setAverageGatheringTime,
};
