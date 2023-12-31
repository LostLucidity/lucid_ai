//@ts-check
"use strict";

// resourceData.js

// Initialize the data structures for storing earmarks and food earmarks
/** @type {Earmark[]} */
const earmarks = [];

/** @type {Map<string, number>} */
const foodEarmarks = new Map();

function resetEarmarks() {
  earmarks.length = 0;
}

// Export the data structures for use in other modules
module.exports = {
  earmarks,
  foodEarmarks,
  resetEarmarks
};
