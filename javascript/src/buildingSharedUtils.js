//@ts-check
"use strict";

// External library imports
const { Ability } = require("@node-sc2/core/constants");

// Internal module imports
const { getDistance } = require("./geometryUtils");
const { createUnitCommand } = require("./utils");
const { getBuilders, getOrderTargetPosition } = require("./workerUtils");

/**
 * Checks if a unit has an add-on.
 * @param {Unit} unit
 * @returns {boolean}
 */
function hasAddOn(unit) {
  return String(unit.addOnTag) !== '0';
}

/**
 * Returns an array of unitCommands to prevent multiple builders on the same task. 
 * @param {UnitResource} units 
 * @param {Unit} builder 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopOverlappingBuilders(units, builder, position) {
  const collectedActions = [];
  const overlappingBuilders = getBuilders(units).filter(otherBuilder => {
    const orderTargetPosition = getOrderTargetPosition(units, otherBuilder);
    return otherBuilder.tag !== builder.tag && orderTargetPosition && getDistance(orderTargetPosition, position) < 1.6;
  });
  if (overlappingBuilders.length > 0) {
    const unitCommand = createUnitCommand(Ability.STOP, overlappingBuilders.map(builder => builder));
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

// Export the shared functions
module.exports = {
  hasAddOn,
  stopOverlappingBuilders,
};
