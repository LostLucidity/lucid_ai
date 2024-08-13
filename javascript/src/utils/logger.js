//@ts-check
"use strict"

const config = require('../../config/config');

/**
 * Formats the current date and time as a string.
 * @returns {string} The formatted timestamp.
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Logs a message if the specified level is less than or equal to the current logging level.
 * The message is prefixed with a timestamp.
 * @param {string} message - The message to log.
 * @param {number} level - The logging level of the message.
 */
function logMessage(message, level) {
  if (config.loggingLevel >= level) {
    console.log(`[${getTimestamp()}] ${message}`);
  }
}

/**
 * Logs an error message.
 * The message is prefixed with a timestamp.
 * @param {string} message - The error message to log.
 * @param {Error} [error] - The error object (optional).
 */
function logError(message, error) {
  if (error) {
    console.error(`[${getTimestamp()}] ${message}\n`, error);
  } else {
    console.error(`[${getTimestamp()}] ${message}`);
  }
}

module.exports = { logMessage, logError };
