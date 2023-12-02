//@ts-check
"use strict";

// placementAndConstructionUtils.js

const { getTimeInSeconds } = require("./utils");

/**
 * Calculates the time it will take for a unit or building to reach a certain position.
 * 
 * @param {number} baseDistanceToPosition - The base distance to the position.
 * @param {number} buildTimeLeft - The remaining build time.
 * @param {number} movementSpeedPerSecond - The movement speed per second.
 * @returns {number} - The calculated time to position.
 */
const calculateBaseTimeToPosition = (baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond) => {
  return (baseDistanceToPosition / movementSpeedPerSecond) + getTimeInSeconds(buildTimeLeft) + movementSpeedPerSecond;
};


module.exports = {
  calculateBaseTimeToPosition,
};
