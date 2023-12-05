//@ts-check
"use strict";

// External library imports
const { Ability } = require('@node-sc2/core/constants');

// Internal module imports
const { getDistance } = require('./geometryUtils');
const { createUnitCommand } = require('./utils');

/**
 * Stops a unit from moving to a specified position.
 * @param {Unit} unit 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopUnitFromMovingToPosition(unit, position) {
  const collectedActions = [];
  const { orders } = unit;
  if (orders === undefined) return collectedActions;
  if (orders.length > 0) {
    const { targetWorldSpacePos } = orders[0];
    if (targetWorldSpacePos === undefined) return collectedActions;
    const distanceToTarget = getDistance(targetWorldSpacePos, position);
    if (distanceToTarget < 1) {
      collectedActions.push(createUnitCommand(Ability.STOP, [unit]));
    }
  }
  return collectedActions;
}

// Export the shared functions
module.exports = {
  stopUnitFromMovingToPosition,
};
