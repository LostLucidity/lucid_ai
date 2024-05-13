// baseUnitUtils.js located in src/core/utils

const { UnitType } = require("@node-sc2/core/constants");

const { getDistance } = require("../../gameLogic/spatial/spatialCoreUtils");
const { checkAddOnPlacement } = require("../../services/ConstructionSpatialService");
const { flyingTypesMapping, liftAndLandingTime, unitTypeTrainingAbilities } = require("../../units/management/unitConfig");

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
 * Check if an order is a training order.
 * @param {SC2APIProtocol.ActionRawUnitCommand} order
 * @param {DataStorage} data
 * @returns {boolean}
 */
function isTrainingOrder(order, data) {
  if (!order.abilityId) return false;
  const trainingUnitType = unitTypeTrainingAbilities.get(order.abilityId);
  return trainingUnitType !== undefined && data.getUnitTypeData(trainingUnitType) !== undefined;
}

module.exports = {
  calculateLiftLandAndMoveTime,
  isTrainingOrder
};
