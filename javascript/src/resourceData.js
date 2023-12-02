//@ts-check
"use strict";

// resourceData.js

// Initialize the data structures for storing earmarks and food earmarks
/** @type {Map<string, number>} */
const foodEarmarks = new Map();
/** @type {Earmark[]} */
const earmarks = [];

// Export the data structures for use in other modules
module.exports = {
  foodEarmarks,
  earmarks,
};
