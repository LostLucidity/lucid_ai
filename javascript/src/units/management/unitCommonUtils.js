/**
 * @namespace CommonUtils
 * @description Utility functions used across various modules.
 */

const { UnitType } = require("@node-sc2/core/constants");

const { flyingTypesMapping, liftAndLandingTime } = require("./unitConfig");
const EarmarkManager = require("../../core/earmarkManager");
const { checkAddOnPlacement } = require("../../services/ConstructionSpatialService");
const { GameState } = require("../../state");
const { getDistance } = require("../../utils/spatialCoreUtils");

/**
 * Calculate the time it takes for a unit with an add-on to lift off (if not already flying), move, and land.
 * @param {World} world - The current world state.
 * @param {Unit} unit - The unit to calculate the lift, move, and land time for.
 * @param {Point2D | undefined} targetPosition - The target position to move to. If undefined, it will be calculated.
  * @param {(world: World, unit: Unit, checkAddOnPlacement: (world: World, unit: Unit, addOnType?: UnitTypeId) => Point2D | undefined) => Point2D | undefined} findBestPositionForAddOnFn - Function to find the best position for an add-on.
 * @returns {number} - The time in seconds it takes to lift off, move, and land.
 */
function calculateLiftMoveAndLandTime(world, unit, targetPosition = undefined, findBestPositionForAddOnFn) {
  if (!world || !unit) return Infinity;

  const { data } = world;
  const { isFlying, pos, unitType } = unit;
  if (isFlying === undefined || pos === undefined || unitType === undefined) return Infinity;

  const unitTypeData = data.getUnitTypeData(UnitType.BARRACKSFLYING);
  if (!unitTypeData || unitTypeData.movementSpeed === undefined) return Infinity;

  const movementSpeedPerSecond = unitTypeData.movementSpeed * 1.4;

  targetPosition = targetPosition || findBestPositionForAddOnFn(world, unit, checkAddOnPlacement);
  if (!targetPosition) return Infinity;

  const distance = getDistance(pos, targetPosition);
  const timeToMove = distance / movementSpeedPerSecond;

  const totalLiftAndLandingTime = (isFlying || flyingTypesMapping.has(unitType)) ? liftAndLandingTime : liftAndLandingTime * 2;

  return totalLiftAndLandingTime + timeToMove;
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 */
function haveSupplyForUnit(world, unitType) {
  if (!world || !unitType) return false;

  const { agent, data } = world;
  if (!agent || !data) return false;

  const { foodCap } = agent;
  if (foodCap === undefined) return false;

  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed();
  const earmarkedFood = EarmarkManager.getEarmarkedFood();

  const unitTypeData = data.getUnitTypeData(unitType);
  if (!unitTypeData || unitTypeData.foodRequired === undefined) return false;

  const supplyLeft = foodCap - foodUsed - earmarkedFood - unitTypeData.foodRequired;
  return supplyLeft >= 0;
}

/**
 * Shuffles an array using the Fisher-Yates algorithm.
 * @template T
 * @param {T[]} array - The array to shuffle.
 * @returns {T[]} The shuffled array.
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

module.exports = {
  calculateLiftMoveAndLandTime,
  haveSupplyForUnit,
  shuffle
};
