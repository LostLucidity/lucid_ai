//@ts-check
"use strict"

const { getEnemyMovementSpeed } = require("./unit-service");

const frameService = {
  /**
   * @param {FrameResource} frame
   * @param {Unit} enemyUnit 
   */
  distanceTraveledPerStep(frame, enemyUnit) {
    const enemyUnitSpeed = getEnemyMovementSpeed(enemyUnit);
    const stepSize = 8;
    const timeElapsedPerStep = stepSize / 22.4;
    return enemyUnitSpeed * 1.4 * timeElapsedPerStep;
  },
  /**
   * @param {number} frames 
   * @returns {number}
   */
  getTimeInSeconds(frames) {
    return frames / 22.4;
  },
}  
module.exports = frameService;