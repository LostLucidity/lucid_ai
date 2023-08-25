//@ts-check
"use strict"

const { getMovementSpeed } = require("./unit-service");

const frameService = {
  /**
   * @param {number} frames 
   * @returns {number}
   */
  getTimeInSeconds(frames) {
    return frames / 22.4;
  },
  /**
   * @param {MapResource} map
   * @param {Unit} unit 
   */
  getTravelDistancePerStep(map, unit) {
    const stepSize = 8;
    const timeElapsedPerStep = stepSize / 22.4;
    return getMovementSpeed(map, unit) * 1.4 * timeElapsedPerStep;
  },
}  
module.exports = frameService;