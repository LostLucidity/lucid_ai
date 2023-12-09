//@ts-check
"use strict"

// Core constants from the Node-SC2 library
const { Difficulty, Race } = require('@node-sc2/core/constants/enums');

// Local module imports
const maps = require('./maps');

/**
 * Configuration settings for the StarCraft 2 bot.
 * @type {{
 *   defaultRace: Race,
 *   defaultDifficulty: Difficulty,
 *   defaultMap: string,
 *   loggingLevel: number,
 *   planMax: { supply: number },
 *   automateSupply: boolean,
 *   naturalWallPylon: boolean
 * }}
 */
module.exports = {
  // Default race of the bot
  defaultRace: Race.RANDOM,

  // Default difficulty level for the AI opponent
  defaultDifficulty: Difficulty.MEDIUM,

  // Default map to play on
  defaultMap: maps.MAP_JAGANNATHA_LE,

  // Logging level: 0 for no logs, 1 for standard logs, 2 for debug logs
  loggingLevel: 1,

  // Maximum supply threshold
  planMax: {
    supply: 0,
  },

  // Whether to automate the building of supply units (true to automate, false to disable)
  automateSupply: true,

  // Prioritize Pylon placement at natural walls for Protoss (true to prioritize, false to not)
  naturalWallPylon: true,
};
