const maps = require('./maps');
const { Difficulty, Race } = require('@node-sc2/core/constants/enums');

module.exports = {
  defaultRace: Race.RANDOM,
  defaultDifficulty: Difficulty.MEDIUM,
  defaultMap: maps.MAP_JAGANNATHA_LE,
  loggingLevel: 1, // 0: No Logs, 1: Standard Logs, 2: Debug Logs
};

