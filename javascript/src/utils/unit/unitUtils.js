// src/utils/unit/unitUtils.js

const { UnitType } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");

const { getDistance } = require("../spatial/spatialCoreUtils");
const { unitTypeTrainingAbilities, flyingTypesMapping, liftAndLandingTime } = require("../unitManagement/unitConfig");

/**
 * Calculate the time it takes for a unit with an add-on to lift off (if not already flying), move, and land.
 * @param {World} world - The current world state.
 * @param {Unit} unit - The unit to calculate the lift, land, and move time for.
 * @param {Point2D | undefined} targetPosition - The target position to move to. If undefined, it will be calculated.
 * @param {(world: World, unit: Unit) => Point2D | undefined} findBestPositionForAddOnFn - Function to find the best position for an add-on.
 * @returns {number} - The time in seconds it takes to lift off, move, and land.
 */
function calculateLiftLandAndMoveTime(world, unit, targetPosition = undefined, findBestPositionForAddOnFn) {
  const { data } = world;
  const { isFlying, pos, unitType } = unit; if (isFlying === undefined || pos === undefined || unitType === undefined) return Infinity;

  // Get movement speed data for a flying barracks
  const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return Infinity;
  const movementSpeedPerSecond = movementSpeed * 1.4;

  targetPosition = targetPosition || findBestPositionForAddOnFn(world, unit); // placeholder function, replace with your own logic
  if (!targetPosition) return Infinity;
  const distance = getDistance(pos, targetPosition); // placeholder function, replace with your own logic
  const timeToMove = distance / movementSpeedPerSecond;

  // If unit is already flying, don't account for the lift-off time
  const totalLiftAndLandingTime = (isFlying || flyingTypesMapping.has(unitType)) ? liftAndLandingTime : liftAndLandingTime * 2;

  return totalLiftAndLandingTime + timeToMove;
}

/**
 * Checks if a structure can lift off.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit can lift off.
 */
function canStructureLiftOff(unit) {
  return unit.availableAbilities().some(ability => groupTypes.liftingAbilities.includes(ability));
}

/**
 * @param {Unit} unit 
 * @returns {UnitTypeId | null}
 */
function getUnitBeingTrained(unit) {
  // Access the unit's orders, assuming they exist and are structured as an array
  const { orders } = unit;
  if (!orders || orders.length === 0) return null;

  // The training order should be the first order in the list
  const trainingOrder = orders[0];
  const { abilityId } = trainingOrder; if (abilityId === undefined) return null;

  // The target type of the training order should be the unit type being trained
  const unitBeingTrained = unitTypeTrainingAbilities.get(abilityId); if (unitBeingTrained === undefined) return null;

  return unitBeingTrained || null;
}

/**
 * Checks if a structure is lifted.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit is lifted.
 */
function isStructureLifted(unit) {
  return unit.availableAbilities().some(ability => groupTypes.landingAbilities.includes(ability));
}

/**
 * Sets a reposition label on a unit with a specified position.
 * @param {Unit} unit The unit to set the label on.
 * @param {Point2D} position The position to set as the label.
 */
const setRepositionLabel = (unit, position) => {
  unit.labels.set('reposition', position);
  console.log('reposition', position);
};


module.exports = {
  calculateLiftLandAndMoveTime,
  canStructureLiftOff,
  getUnitBeingTrained,
  isStructureLifted,
  setRepositionLabel,
};
