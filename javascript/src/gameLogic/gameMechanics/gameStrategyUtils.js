// src/utils/gameStrategyUtils.js

const { Alliance } = require("@node-sc2/core/constants/enums");

const { potentialCombatants, getWeaponDPS } = require("../../units");
const { mappedEnemyUnits } = require("../../utils/scoutingUtils");
const { calculateTimeToKillUnits } = require("../../utils/sharedUtils");
const { getDistance } = require("../../utils/spatialCoreUtils");


/**
 * @typedef {Object} GameState
 * @property {import("../../features/strategy/strategyManager").PlanStep[]} plan - An array representing the game plan
 */

const gameStrategyUtils = {
  /**
   * @param {World} world
   * @param {Unit[]} trainers
   */
  filterSafeTrainers(world, trainers) {
    return trainers.filter((trainer) => trainer.pos && gameStrategyUtils.isStrongerAtPosition(world, trainer.pos));
  },

  /**
   * Determines if the given step is a BuildOrderStep.
   * @param {import("../../core/globalTypes").BuildOrderStep | import("../../features/strategy/strategyManager").StrategyStep} step
   * @returns {step is import("../../core/globalTypes").BuildOrderStep}
   */
  isBuildOrderStep(step) {
    return 'uniquePropertyOfBuildOrderStep' in step; // Replace with an actual unique property
  },

  /**
   * Checks if the player's units are stronger at a specific position compared to enemy units.
   * @param {World} world - The current game world state.
   * @param {Point2D} position - The position to check.
   * @returns {boolean} - Returns true if the player's units are stronger at the given position, otherwise false.
   */
  isStrongerAtPosition(world, position) {
    const { units } = world.resources.get();

    /**
     * Retrieves units within a specified radius from a position.
     * @param {Unit[]} unitArray - Array of units.
     * @param {number} rad - Radius to filter units by.
     * @returns {Unit[]} - Units within the specified radius.
     */
    const getUnitsInRadius = (unitArray, rad) =>
      unitArray.filter(unit => unit.pos && getDistance(unit.pos, position) < rad);

    let enemyUnits = getUnitsInRadius(mappedEnemyUnits, 16).filter(potentialCombatants);

    // If there's only one enemy and it's a non-combatant worker, disregard it
    if (enemyUnits.length === 1 && !potentialCombatants(enemyUnits[0])) {
      enemyUnits = [];
    }

    // If no potential enemy combatants, player is stronger by default
    if (!enemyUnits.length) return true;

    const selfUnits = getUnitsInRadius(units.getAlive(Alliance.SELF), 16).filter(potentialCombatants);
    return gameStrategyUtils.shouldEngage(world, selfUnits, enemyUnits);
  },

  /**
   * Determines if a group of selfUnits should engage against a group of enemyUnits.
   * @param {World} world
   * @param {Unit[]} selfUnits
   * @param {Unit[]} enemyUnits
   * @returns {boolean}
   */
  shouldEngage(world, selfUnits, enemyUnits) {
    if (selfUnits.length === 0 && enemyUnits.length === 0) {
      return true;  // Modify as per your game's logic
    }

    const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfUnits, enemyUnits, getWeaponDPS);

    // Engage if self units can eliminate enemy units faster than they can be eliminated
    return timeToKill <= timeToBeKilled;
  }
};

module.exports = gameStrategyUtils;
