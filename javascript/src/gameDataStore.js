//@ts-check
"use strict";

/**
 * A central store for shared game data across modules.
 * This store resolves the circular dependency between gameState.js and unitManagement.js.
 */

/** 
 * A collection of units that are known to exist but are not currently tracked by the bot's own data structures.
 * @type {Unit[]}
 */
const missingUnits = [];

module.exports = {
  missingUnits,
};
