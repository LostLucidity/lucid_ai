// src/features/shared/timeUtils.js

const { Buff } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");

const { getDistance } = require("./pathfinding/spatialCoreUtils");
const { unitTypeTrainingAbilities } = require("../../units/management/unitConfig");

/**
 * @param {number} frames 
 * @returns {number}
 */
function getTimeInSeconds(frames) {
  return frames / 22.4;
}

/**
 * Calculates the remaining build time for a unit, considering buffs like Chrono Boost.
 * 
 * @param {Unit} unit - The unit being trained or constructed.
 * @param {number | undefined} buildTime - The base build time of the unit or structure.
 * @param {number} progress - The current build progress of the unit or structure.
 * @returns {number} - The remaining build time in game frames.
 */
function getBuildTimeLeft(unit, buildTime, progress) {
  // Handle undefined buildTime by returning a large number, indicating the build is not close to finishing
  if (buildTime === undefined) return Number.MAX_SAFE_INTEGER;

  const { buffIds } = unit;
  if (buffIds && buffIds.includes(Buff.CHRONOBOOSTENERGYCOST)) {
    buildTime = buildTime * 2 / 3;  // Chrono Boost accelerates construction/training time
  }

  return Math.round(buildTime * (1 - progress));
}

/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getConstructionTimeLeft(world, unit, inSeconds = true) {
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos, targetUnitTag } = constructingOrder; if (targetWorldSpacePos === undefined && targetUnitTag === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  let targetPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined; if (targetPosition === undefined) return 0;
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && getDistance(unit.pos, targetPosition) < 1);
  const { buildTime } = data.getUnitTypeData(unitTypeBeingConstructed); if (buildTime === undefined) return 0;
  if (unitAtTargetPosition !== undefined) {
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
  } else {
    buildTimeLeft = buildTime;
  }
  if (inSeconds) {
    return getTimeInSeconds(buildTimeLeft);
  }
  return buildTimeLeft;
}

module.exports = {
  getBuildTimeLeft,
  getConstructionTimeLeft,
  getTimeInSeconds,
};
