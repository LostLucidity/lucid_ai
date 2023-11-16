//@ts-check
"use strict"

const { foodData } = require("./data-utils");

// Include any necessary imports that getFoodUsed function depends on

/**
 * Get the amount of food used.
 * @returns {number}
 */
function getFoodUsed() {
  return foodData.foodUsed;
} 

module.exports = {
  getFoodUsed,
};
