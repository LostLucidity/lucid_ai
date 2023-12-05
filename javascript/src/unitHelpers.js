//@ts-check
"use strict";

// External library imports from '@node-sc2/core/constants'
const { UnitType, UnitTypeId } = require('@node-sc2/core/constants');
const groupTypes = require('@node-sc2/core/constants/groups');

// Internal module imports for utility functions and configurations
const { findBestPositionForAddOn } = require('./buildingUnitHelpers');
const { getDistance } = require('./geometryUtils');
const { unitTypeTrainingAbilities, liftAndLandingTime, flyingTypesMapping } = require('./unitConfig');

/**
 * Calculate the time it takes for a unit with an add-on to lift off (if not already flying), move, and land
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D | undefined} targetPosition
 * @returns {number}
 */
function calculateLiftLandAndMoveTime(world, unit, targetPosition = undefined) {
  const { data } = world;
  const { isFlying, pos, unitType } = unit; if (isFlying === undefined || pos === undefined || unitType === undefined) return Infinity;

  // Get movement speed data for a flying barracks
  const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return Infinity;
  const movementSpeedPerSecond = movementSpeed * 1.4;

  targetPosition = targetPosition || findBestPositionForAddOn(world, unit); // placeholder function, replace with your own logic
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
 * Returns the unit type to build based on the given unit and add-on type.
 * @param {Unit} unit 
 * @param {Map<number, number>} flyingTypesMapping 
 * @param {UnitTypeId} addOnType 
 * @returns {UnitTypeId | undefined}
 */
function getUnitTypeToBuild(unit, flyingTypesMapping, addOnType) {
  if (unit.unitType === undefined || addOnType === undefined) {
    // Handle the case where unit.unitType or addOnType is undefined
    console.error("Undefined unit type or addOn type encountered in getUnitTypeToBuild.");
    return undefined;
  }

  const flyingType = flyingTypesMapping.get(unit.unitType);
  const baseUnitType = flyingType !== undefined ? flyingType : unit.unitType;

  const unitTypeString = `${UnitTypeId[baseUnitType]}${UnitTypeId[addOnType]}`;
  return UnitType[unitTypeString];
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
 * Returns updated addOnType using countTypes.
 * @param {UnitTypeId} addOnType 
 * @param {Map} countTypes 
 * @returns {UnitTypeId}
 */
function updateAddOnType(addOnType, countTypes) {
  for (const [key, value] of countTypes.entries()) {
    if (value.includes(addOnType)) {
      return key;
    }
  }
  return addOnType;
}

// Export the shared functions
module.exports = {
  calculateLiftLandAndMoveTime,
  canStructureLiftOff,
  getUnitTypeToBuild,
  getUnitBeingTrained,
  isStructureLifted,
  updateAddOnType,
};
