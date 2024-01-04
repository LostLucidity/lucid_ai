// resourceData.js

"use strict";

/** @typedef {{ name: string, minerals: number, vespene: number }} Earmark */

// Initialize the data structures for storing earmarks and food earmarks
/** @type {Earmark[]} */
const earmarks = [];

/** @type {Map<string, number>} */
const foodEarmarks = new Map();

/**
 * Resets all earmarks.
 * 
 * Assuming `data` is an object that has a method `get` which returns an array,
 * and a method `settleEarmark` which takes a string.
 * This function clears both general and food earmarks.
 * 
 * @param {{ get: (key: string) => Earmark[], settleEarmark: (name: string) => void }} data The data object
 */
function resetEarmarks(data) {
  // Clear general earmarks
  earmarks.length = 0;
  data.get('earmarks').forEach((earmark) => data.settleEarmark(earmark.name));

  // Clear food earmarks
  foodEarmarks.clear();
}

// Export the data structures for use in other modules
module.exports = {
  earmarks,
  foodEarmarks,
  resetEarmarks
};
