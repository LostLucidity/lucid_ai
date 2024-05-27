// src/utils/common/logging.js
"use strict";

/**
 * Storage object for log message flags to prevent repeated logging.
 * @typedef {Object} LogMessageStorage
 * @property {boolean} noFreeGeysers - Flag to indicate if the "no free geysers" message has been logged.
 * @property {boolean} noFreeGeysersLogged - Flag to indicate if the "no free geysers" logging is active.
 * @property {boolean} noValidPositionLogged - Flag to indicate if the "no valid position" message has been logged.
 */

/** @type {LogMessageStorage} */
const logMessageStorage = {
  noFreeGeysers: false,
  noFreeGeysersLogged: false,
  noValidPositionLogged: false,
};

module.exports = {
  logMessageStorage,
};
