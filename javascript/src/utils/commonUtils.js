/**
 * @namespace CommonUtils
 * @description Utility functions used across various modules.
 */

const { UnitType } = require("@node-sc2/core/constants");

const { EarmarkManager } = require("../core");
const { getDistance } = require("../features/shared/pathfinding/spatialCoreUtils");
const { GameState } = require("../gameState");
const { checkAddOnPlacement } = require("../services/ConstructionSpatialService");
const { flyingTypesMapping, liftAndLandingTime } = require("../units/management/unitConfig");

/**
 * Calculate the time it takes for a unit with an add-on to lift off (if not already flying), move, and land.
 * @param {World} world - The current world state.
 * @param {Unit} unit - The unit to calculate the lift, land, and move time for.
 * @param {Point2D | undefined} targetPosition - The target position to move to. If undefined, it will be calculated.
 * @param {(world: World, unit: Unit,  checkAddOnPlacement: (world: World, unit: Unit, addOnType?: UnitTypeId) => Point2D | undefined) => Point2D | undefined} findBestPositionForAddOnFn - Function to find the best position for an add-on.
 * @returns {number} - The time in seconds it takes to lift off, move, and land.
 */
function calculateLiftLandAndMoveTime(world, unit, targetPosition = undefined, findBestPositionForAddOnFn) {
  const { data } = world;
  const { isFlying, pos, unitType } = unit; if (isFlying === undefined || pos === undefined || unitType === undefined) return Infinity;

  // Get movement speed data for a flying barracks
  const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return Infinity;
  const movementSpeedPerSecond = movementSpeed * 1.4;

  targetPosition = targetPosition || findBestPositionForAddOnFn(world, unit, checkAddOnPlacement); // placeholder function, replace with your own logic
  if (!targetPosition) return Infinity;
  const distance = getDistance(pos, targetPosition); // placeholder function, replace with your own logic
  const timeToMove = distance / movementSpeedPerSecond;

  // If unit is already flying, don't account for the lift-off time
  const totalLiftAndLandingTime = (isFlying || flyingTypesMapping.has(unitType)) ? liftAndLandingTime : liftAndLandingTime * 2;

  return totalLiftAndLandingTime + timeToMove;
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 */
function haveSupplyForUnit(world, unitType) {
  const { agent, data } = world;
  const { foodCap } = agent; if (foodCap === undefined) return false;
  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed();
  const earmarkedFood = EarmarkManager.getEarmarkedFood();
  const { foodRequired } = data.getUnitTypeData(unitType); if (foodRequired === undefined) return false;
  const supplyLeft = foodCap - foodUsed - earmarkedFood - foodRequired;
  return supplyLeft >= 0;
}

module.exports = {
  calculateLiftLandAndMoveTime,
  haveSupplyForUnit,
};
