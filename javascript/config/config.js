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
};

/**
 * Validate and return the logging level, ensuring it falls within the expected range.
 * @param {number} level The provided logging level.
 * @returns {number} The validated logging level.
 */
function getValidatedLoggingLevel(level) {
  const validLevels = [0, 1, 2]; // Example of expected logging levels
  return validLevels.includes(level) ? level : DEFAULTS.LOGGING_LEVEL;
}

module.exports = {
  defaultRace: process.env.DEFAULT_RACE || DEFAULTS.RACE,
  defaultDifficulty: process.env.DEFAULT_DIFFICULTY || DEFAULTS.DIFFICULTY,
  defaultMap: process.env.DEFAULT_MAP || DEFAULTS.MAP,
  loggingLevel: getValidatedLoggingLevel(parseInt(process.env.LOGGING_LEVEL || '0', 10)),
  planMax: DEFAULTS.PLAN_MAX,
  automateSupply: process.env.AUTOMATE_SUPPLY === 'true' || DEFAULTS.AUTOMATE_SUPPLY,
  naturalWallPylon: process.env.NATURAL_WALL_PYLON === 'true' || DEFAULTS.NATURAL_WALL_PYLON,
  debugBuildOrderKey: process.env.DEBUG_BUILD_ORDER_KEY || null,
};
