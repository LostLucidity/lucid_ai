// unitCapabilityUtils.js

"use strict";

const { hasAddOn, findBestPositionForAddOn } = require("./constructionAndBuildingUtils");
const { checkUnitCount } = require("./stateManagement");
const { flyingTypesMapping, unitTypeTrainingAbilities } = require("../../unitConfig");
const { calculateLiftLandAndMoveTime } = require("../../unitHelpers");
const { getTimeInSeconds } = require("../../utils");

/**
 * Determines if a unit can be trained based on the target count.
 * @param {World} world The current game world.
 * @param {number} unitTypeId Type of the unit.
 * @param {number | null} targetCount Target number of units.
 * @returns {boolean}
 */
const canTrainUnit = (world, unitTypeId, targetCount) => {
  return targetCount === null || checkUnitCount(world, unitTypeId, targetCount);
};

/**
 * @param {World} world
 * @param {Unit} unit
 * @returns {number}
 */
function getTimeUntilUnitCanBuildAddon(world, unit) {
  const { data } = world;
  const { buildProgress, isFlying, orders, pos, unitType } = unit;
  if (buildProgress === undefined || isFlying === undefined || orders === undefined || pos === undefined || unitType === undefined) return Infinity;

  // If unit is under construction, calculate the time until it finishes
  if (buildProgress !== undefined && buildProgress < 1) {
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return Infinity;
    const remainingTime = getTimeInSeconds(buildTime - (buildTime * buildProgress));
    return remainingTime;
  }

  // If unit is idle, check if it already has an add-on
  if (unit.isIdle()) {
    // If unit already has an add-on, calculate the time it takes for the structure to lift off, move, and land
    if (hasAddOn(unit)) {
      return calculateLiftLandAndMoveTime(world, unit, undefined, findBestPositionForAddOn);
    } else if (isFlying) {
      return calculateLiftLandAndMoveTime(world, unit, undefined, findBestPositionForAddOn);
    }
    return 0;
  }

  // If unit is flying or its unit type indicates that it's a flying unit
  if (isFlying || flyingTypesMapping.has(unitType)) {
    if (orders && orders.length > 0) {
      const order = orders[0];
      if (order.targetWorldSpacePos) {
        return calculateLiftLandAndMoveTime(world, unit, order.targetWorldSpacePos, findBestPositionForAddOn);
      }
    }
    return Infinity;
  }

  // If unit is training or doing something else, calculate the time until it finishes
  if (orders && orders.length > 0) {
    const order = orders[0];
    const { abilityId, progress } = order; if (abilityId === undefined || progress === undefined) return Infinity;
    const unitTypeTraining = unitTypeTrainingAbilities.get(abilityId); if (unitTypeTraining === undefined) return Infinity;
    const { buildTime } = data.getUnitTypeData(unitTypeTraining); if (buildTime === undefined) return Infinity;

    const remainingTime = getTimeInSeconds(buildTime - (buildTime * progress));
    if (hasAddOn(unit)) {
      return remainingTime + calculateLiftLandAndMoveTime(world, unit, undefined, findBestPositionForAddOn);
    }
    return remainingTime;
  }

  // If unit is not idle, not under construction, and not building something, assume it will take a longer time to be available
  return Infinity;
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
  canTrainUnit,
  getTimeUntilUnitCanBuildAddon,
  isTrainingOrder,
};
