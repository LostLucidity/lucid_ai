//@ts-check
"use strict";

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getDistance } = require("../../../services/position-service");
const unitService = require("../../../services/unit-service");
const enemyTrackingService = require("../enemy-tracking");
const { EngagementLogicService } = require("../army-management/engagement-logic");

// combat-evaluation-service.js

/**
 * Checks if the player's units are stronger at a specific position compared to enemy units.
 *
 * @param {World} world - The current game world state.
 * @param {Point2D} position - The position to check.
 * @returns {boolean} - Returns true if the player's units are stronger at the given position, otherwise false.
 */
function isStrongerAtPosition(world, position)  {
  const { units } = world.resources.get();

  /**
   * Retrieves units within a specified radius from a position.
   * @param {Unit[]} unitArray - Array of units.
   * @param {number} rad - Radius to filter units by.
   * @returns {Unit[]} - Units within the specified radius.
   */
  const getUnitsInRadius = (unitArray, rad) =>
    unitArray.filter(unit => unit.pos && getDistance(unit.pos, position) < rad);

  let enemyUnits = getUnitsInRadius(enemyTrackingService.mappedEnemyUnits, 16).filter(unitService.potentialCombatants);

  // If there's only one enemy and it's a non-combatant worker, disregard it
  if (enemyUnits.length === 1 && !unitService.potentialCombatants(enemyUnits[0])) {
    enemyUnits = [];
  }

  // If no potential enemy combatants, player is stronger by default
  if (!enemyUnits.length) return true;

  const selfUnits = getUnitsInRadius(units.getAlive(Alliance.SELF), 16).filter(unitService.potentialCombatants);
  const engagementLogic = new EngagementLogicService();
  return engagementLogic.shouldEngage(world, selfUnits, enemyUnits);
}

module.exports = { isStrongerAtPosition };
