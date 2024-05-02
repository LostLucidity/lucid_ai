//@ts-check
"use strict"

const config = require('../../../config/config');

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

module.exports = { logMessage, logError };
