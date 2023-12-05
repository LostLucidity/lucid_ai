//@ts-check
"use strict";

// External library imports
const { UnitType, UnitTypeId } = require("@node-sc2/core/constants");
const groupTypes = require("@node-sc2/core/constants/groups");

// Internal module imports: Game State and Building Utilities
const BuildingPlacement = require("./buildingPlacement");
const { hasAddOn } = require("./buildingSharedUtils");
const { setPendingOrders } = require("./common");
const GameState = require("./gameState");
const { addEarmark } = require("./resourceUtils");
const { getPendingOrders } = require("./sharedUtils");
// Internal module imports: Unit Configuration and Actions
const { attemptBuildAddOn, attemptLiftOff } = require("./unitActions");
const { canUnitBuildAddOn, flyingTypesMapping, unitTypeTrainingAbilities } = require("./unitConfig");
const { calculateLiftLandAndMoveTime, updateAddOnType, getUnitTypeToBuild } = require("./unitHelpers");
const { getTimeInSeconds } = require("./utils");

/**
 * Adds addon, with placement checks and relocating logic.
 * @param {World} world 
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {Promise<void>}
 */
async function addAddOn(world, unit, addOnType) {
  const { landingAbilities, liftingAbilities } = groupTypes;
  const { data, resources } = world;
  const { actions } = resources.get();
  const { tag } = unit;
  if (tag === undefined) return;

  const gameState = GameState.getInstance();
  addOnType = updateAddOnType(addOnType, gameState.countTypes);
  const unitTypeToBuild = getUnitTypeToBuild(unit, flyingTypesMapping, addOnType);

  // Check if unitTypeToBuild is defined and retrieve abilityId
  if (unitTypeToBuild === undefined) return;
  const unitTypeData = data.getUnitTypeData(unitTypeToBuild);
  if (!unitTypeData || unitTypeData.abilityId === undefined) return;
  const abilityId = unitTypeData.abilityId;

  const unitCommand = { abilityId, unitTags: [tag] };

  if (!unit.noQueue || unit.labels.has('swapBuilding') || getPendingOrders(unit).length > 0) {
    return;
  }

  const availableAbilities = unit.availableAbilities();

  if (unit.abilityAvailable(abilityId)) {
    if (await attemptBuildAddOn(world, unit, addOnType, unitCommand)) {
      addEarmark(data, unitTypeData);
      return;
    }
  }

  if (availableAbilities.some(ability => liftingAbilities.includes(ability))) {
    if (await attemptLiftOff(actions, unit)) {
      return;
    }
  }

  if (availableAbilities.some(ability => landingAbilities.includes(ability))) {
    await attemptLand(world, unit, addOnType);
  }
}

/**
 * Attempts to land the unit at a suitable location.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} addOnType 
 * @returns {Promise<void>}
 */
async function attemptLand(world, unit, addOnType) {
  const { data, resources } = world;
  const { actions } = resources.get();
  const { tag, unitType } = unit; if (tag === undefined || unitType === undefined) return;
  const foundPosition = BuildingPlacement.checkAddOnPlacement(world, unit, addOnType);

  if (!foundPosition) {
    return;
  }

  unit.labels.set('addAddOn', foundPosition);

  const unitCommand = {
    abilityId: data.getUnitTypeData(UnitType[`${UnitTypeId[flyingTypesMapping.get(unitType) || unitType]}${UnitTypeId[addOnType]}`]).abilityId,
    unitTags: [tag],
    targetWorldSpacePos: foundPosition
  }

  await actions.sendAction(unitCommand);
  setPendingOrders(unit, unitCommand);
  addEarmark(data, data.getUnitTypeData(addOnType));
}

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
      return calculateLiftLandAndMoveTime(world, unit);
    } else if (isFlying) { // New condition for flying and idle units
      return calculateLiftLandAndMoveTime(world, unit);
    }
    return 0;
  }

  // If unit is flying or its unit type indicates that it's a flying unit
  if (isFlying || flyingTypesMapping.has(unitType)) {
    if (orders && orders.length > 0) {
      const order = orders[0];
      if (order.targetWorldSpacePos) {
        return calculateLiftLandAndMoveTime(world, unit, order.targetWorldSpacePos);
      }
    }

    // If the unit's orders don't provide a target position, return Infinity
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
      return remainingTime + calculateLiftLandAndMoveTime(world, unit);
    }
    return remainingTime;
  }

  // If unit is not idle, not under construction, and not building something, assume it will take a longer time to be available
  return Infinity;
}

/**
 * Get units that are capable to add an add-on (either they don't have one or they have one but can add another).
 * @param {Unit[]} units 
 * @returns {Unit[]}
 */
function getUnitsCapableToAddOn(units) {
  return units.filter(unit => unit.unitType && canUnitBuildAddOn(unit.unitType));
}

module.exports = {
  addAddOn,
  getTimeUntilUnitCanBuildAddon,
  getUnitsCapableToAddOn,
};
