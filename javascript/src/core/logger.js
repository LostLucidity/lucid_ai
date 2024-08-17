"use strict";

const config = require('../../config/config');

/** @type {string | null} */
let cachedTimestamp = null;
let timestampExpiration = 0;

/**
 * Gets the current timestamp, caching it for a short duration to avoid recalculating for each log.
 * @returns {string} The cached or new timestamp.
 */
function getCurrentTimestamp() {
  const now = Date.now();
  if (now > timestampExpiration || cachedTimestamp === null) {
    cachedTimestamp = new Date(now).toISOString();
    timestampExpiration = now + 1000; // Cache the timestamp for 1 second
  }
  return cachedTimestamp || new Date().toISOString(); // Ensure a string is always returned
}

/**
 * Logs a message if the specified level is less than or equal to the current logging level.
 * The message is prefixed with a timestamp.
 * @param {string} message - The message to log.
 * @param {number} level - The logging level of the message.
 */
function logMessage(message, level) {
  if (config.loggingLevel >= level) {
    console.log(`[${getCurrentTimestamp()}] ${message}`);
  }
}

/**
 * Logs an error message.
 * The message is prefixed with a timestamp.
 * @param {string} message - The error message to log.
 * @param {Error} [error] - The error object (optional).
 */
function logError(message, error) {
  const timestamp = getCurrentTimestamp();
  if (error) {
    console.error(`[${timestamp}] ${message}\n`, error);
  } else {
    console.error(`[${timestamp}] ${message}`);
  }
}

module.exports = { logMessage, logError };
