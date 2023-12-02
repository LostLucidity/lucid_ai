//@ts-check
"use strict"

// === IMPORTS ===

const groupTypes = require("@node-sc2/core/constants/groups");
const worldService = require("../world-service");
const { getTimeToTargetCost, getTimeToTargetTech } = require("./common-utilities");
const { pathFindingService } = require("../services/pathfinding");
const { MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { UnitType } = require("@node-sc2/core/constants");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");

// === UTILITY FUNCTIONS ===

/**
 * @param {SC2APIProtocol.Point2D} point1
 * @param {SC2APIProtocol.Point2D} point2
 * @param {number} epsilon
 * @returns {boolean}
 */
const areApproximatelyEqual = (point1, point2, epsilon = 0.0002) => {
  if (point1.x === undefined || point1.y === undefined || point2.x === undefined || point2.y === undefined) {
    return false;
  }

  const dx = Math.abs(point1.x - point2.x);
  const dy = Math.abs(point1.y - point2.y);

  return dx < epsilon && dy < epsilon;
}

/**
 * @param {Point2D} buildingPosition
 * @param {Point2D} unitPosition
 * @returns {Point2D}
 */
function getAwayPosition(buildingPosition, unitPosition) {
  // Default to 0 if undefined
  const unitX = unitPosition.x || 0;
  const unitY = unitPosition.y || 0;
  const buildingX = buildingPosition.x || 0;
  const buildingY = buildingPosition.y || 0;

  const dx = unitX - buildingX;
  const dy = unitY - buildingY;
  return {
    x: unitX + dx,
    y: unitY + dy
  };
}

/**
 * 
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
      collectedActions.push(createUnitCommand(STOP, [unit]));
    }
  }
  return collectedActions;
}

// === EXPORTS ===

module.exports = {
};
