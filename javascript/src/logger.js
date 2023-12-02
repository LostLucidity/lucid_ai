//@ts-check
"use strict"

const config = require('../config/config');

/**
 * Logs a message if the specified level is less than or equal to the current logging level.
 * @param {string} message - The message to log.
 * @param {number} level - The logging level of the message.
 */
function logMessage(message, level) {
  if (config.loggingLevel >= level) {
    console.log(message);
  }
}

/**
 * Logs an error message.
 * @param {string} message - The error message to log.
 * @param {Error} [error] - The error object (optional).
 */
function logError(message, error) {
  if (error) {
    console.error(`${message}\n`, error);
  } else {
    console.error(message);
  }
}

/**
 * Unpause and log on attempted steps.
 * @param {World} world 
 * @param {string} name 
 * @param {ILoggingService} loggingService The logging service to be used.
 * @param {IArmyManagementServiceMinimal} armyManagementServiceMinimal The army management service to be used.
 * @param {string} extra 
 */
function unpauseAndLog(world, name, loggingService, armyManagementServiceMinimal, extra = '') {
  const { agent, resources } = world;
  const { frame } = resources.get();
  if (!(WorkerRace[agent.race] === UnitType[name])) {
    setAndLogExecutedSteps(world, frame.timeInSeconds(), name, loggingService, armyManagementServiceMinimal, extra);
  }
}

module.exports = { logMessage, logError, unpauseAndLog };

module.exports = { logMessage, logError };
