//@ts-check
"use strict";

const { calculateTimeToKillUnits } = require("../../combat-statistics");
const combatUtils = require("../../../shared-utilities/combat-utilities");

class EngagementLogicService {
  constructor() {
    // ... any initial properties or dependencies ...
  }

  /**
   * Determines if a group of selfUnits should engage against a group of enemyUnits.
   * @param {World} world
   * @param {Unit[]} selfUnits
   * @param {Unit[]} enemyUnits
   * @returns {boolean}
   */
  shouldEngage(world, selfUnits, enemyUnits) {
    if (selfUnits.length === 0 && enemyUnits.length === 0) {
      // Modify this return value or add logic as per your game's requirements
      return true; // or false, or any other handling you find appropriate
    }

    const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfUnits, enemyUnits);

    // Engage if self units can eliminate enemy units faster than they can be eliminated
    return timeToKill <= timeToBeKilled;
  }

  /**
   * Determines the best position for engaging the enemy.
   * @param {Object} world - The current state of the game world.
   * @param {Array} selfUnits - Our own units.
   * @param {Array} enemyUnits - Enemy units.
   * @returns {Point2D} - The best position to engage from.
   */
  getBestEngagementPosition(world, selfUnits, enemyUnits) {
    // Hypothetical logic
    const enemyCenter = combatUtils.calculateCenterOfMass(enemyUnits);
    const ourCenter = combatUtils.calculateCenterOfMass(selfUnits);
    // Some function to determine the best position between the two centers.
    return combatUtils.determineOptimalEngagePoint(ourCenter, enemyCenter);
  }

  /**
   * Decides if our army should continue the engagement or disengage.
   * @param {Object} world - The current state of the game world.
   * @param {Array} selfUnits - Our own units.
   * @param {Array} enemyUnits - Enemy units.
   * @returns {boolean} - Whether or not to continue engagement.
   */
  shouldContinueEngagement(world, selfUnits, enemyUnits) {
    const ourStrength = unitAnalysisService.calculateArmyStrength(selfUnits);
    const enemyStrength = unitAnalysisService.calculateArmyStrength(enemyUnits);
    // Hypothetical logic: continue if our strength is greater than 80% of the enemy's.
    return ourStrength > 0.8 * enemyStrength;
  }

}

module.exports = EngagementLogicService;
