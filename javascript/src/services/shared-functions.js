// shared-functions.js
//@ts-check
"use strict"

const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { UnitType } = require("@node-sc2/core/constants");
const loggingService = require("./logging/logging-service");

/**
 * Unpause and log on attempted steps.
 * @param {World} world 
 * @param {string} name 
 * @param {string} extra 
*/
function unpauseAndLog(world, name, extra = '') {
  const { agent, resources } = world;
  const { frame } = resources.get();
  if (!(WorkerRace[agent.race] === UnitType[name])) {
    loggingService.setAndLogExecutedSteps(world, frame.timeInSeconds(), name, extra);
  }
}

// Export the functions
module.exports = {
  unpauseAndLog,
};
