require('dotenv').config();
const { Difficulty, Race } = require('@node-sc2/core/constants/enums');

const maps = require('./maps');
const { parseBooleanEnv, parseNumberEnv } = require('./utils');

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
  DYNAMIC_ENERGY_THRESHOLD: 75,
  LOG_INTERVAL: 5,
  REAL_TIME_CHECK_INTERVAL: 60000,
  MIN_ENERGY: 50,
  MAX_DISTANCE: 10,
};

// Initialize averageGatheringTime with a default value
let averageGatheringTime = 4;

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
 * Validates logging level, defaulting to a valid level if the input is invalid.
 * @param {number} level - Desired logging level.
 * @returns {number} - Validated logging level.
 */
function getValidatedLogLevel(level) {
  const validLevels = [0, 1, 2];
  return validLevels.includes(level) ? level : DEFAULTS.LOGGING_LEVEL;
}

// Map to convert race names to their enum values
const RACE_ENUM_MAP = {
  'TERRAN': Race.TERRAN,
  'ZERG': Race.ZERG,
  'PROTOSS': Race.PROTOSS,
};

/**
 * Converts a race name to its enum value.
 * @param {string | undefined} raceName - The name of the race.
 * @returns {Race} - Enum value for the race.
 */
function getRaceEnumValue(raceName) {
  const normalizedRaceName = (raceName ?? '').toUpperCase();
  return RACE_ENUM_MAP[/** @type {keyof typeof RACE_ENUM_MAP} */ (normalizedRaceName)] || DEFAULTS.RACE;
}

module.exports = {
  defaultRace: getRaceEnumValue(process.env.DEFAULT_RACE),
  defaultDifficulty: process.env.DEFAULT_DIFFICULTY || DEFAULTS.DIFFICULTY,
  defaultMap: process.env.DEFAULT_MAP || DEFAULTS.MAP,
  loggingLevel: getValidatedLogLevel(parseNumberEnv(process.env.LOGGING_LEVEL, 1)), // Defaults to level 1 if undefined
  planMax: DEFAULTS.PLAN_MAX,
  automateSupply: parseBooleanEnv(process.env.AUTOMATE_SUPPLY, DEFAULTS.AUTOMATE_SUPPLY),
  naturalWallPylon: parseBooleanEnv(process.env.NATURAL_WALL_PYLON, DEFAULTS.NATURAL_WALL_PYLON),
  debugBuildOrderKey: process.env.DEBUG_BUILD_ORDER_KEY || null,
  maxTownHalls: DEFAULTS.MAX_TOWN_HALLS,
  townHallCost: DEFAULTS.TOWN_HALL_COST,
  DYNAMIC_ENERGY_THRESHOLD: DEFAULTS.DYNAMIC_ENERGY_THRESHOLD,
  LOG_INTERVAL: DEFAULTS.LOG_INTERVAL,
  REAL_TIME_CHECK_INTERVAL: DEFAULTS.REAL_TIME_CHECK_INTERVAL,
  MIN_ENERGY: DEFAULTS.MIN_ENERGY,
  MAX_DISTANCE: DEFAULTS.MAX_DISTANCE,
  getAverageGatheringTime,
  setAverageGatheringTime,
};
