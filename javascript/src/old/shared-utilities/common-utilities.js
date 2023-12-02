//@ts-check
"use strict"

// === IMPORTS & CONSTANTS ===

// === FUNCTION DEFINITIONS ===

/**
 * Checks if a given position is on the creep.
 * @param {Point2D} position - The position to check.
 * @returns {Boolean} - True if the position is on the creep, false otherwise.
 */
function isOnCreep(position) {
  const { x, y } = position;
  if (x === undefined || y === undefined) return false;
  const grid = `${Math.floor(x)}:${Math.floor(y)}`;
  return MapResourceService.creepPositionsSet.has(grid);
}

// Export the functions
module.exports = {
  isOnCreep,
};