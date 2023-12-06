//@ts-check
"use strict";

// External library imports
const { Ability, UnitType } = require("@node-sc2/core/constants");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

// Internal module imports: Game State and Utilities
const { findBestPositionForAddOn } = require("./buildingUnitHelpers");
const { setPendingOrders } = require("./common");
const GameState = require("./gameState");
const { getDistance } = require("./geometryUtils");
const { pointsOverlap } = require("./mapUtils");
// Internal module imports: Building and Unit Management
const { getAddOnPlacement } = require("./placementUtils");
const { addEarmark } = require("./resourceUtils");
const { getPendingOrders } = require("./sharedUtils");
const { flyingTypesMapping, liftAndLandingTime } = require("./unitConfig");
const { getUnitBeingTrained, isStructureLifted, canStructureLiftOff } = require("./unitHelpers");
const { getFoodUsedByUnitType, createUnitCommand } = require("./utils");

/** @type {Point2D[]} */
const seigeTanksSiegedGrids = [];

/**
 * Attempt to build addOn
 * @param {World} world
 * @param {Unit} unit
 * @param {UnitTypeId} addOnType
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function attemptBuildAddOn(world, unit, addOnType, unitCommand) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { pos } = unit; if (pos === undefined) return [];
  const addonPlacement = getAddOnPlacement(pos);
  const addOnFootprint = getFootprint(addOnType);

  if (addOnFootprint === undefined) return [];

  const canPlace = map.isPlaceableAt(addOnType, addonPlacement) &&
    !pointsOverlap(cellsInFootprint(addonPlacement, addOnFootprint), seigeTanksSiegedGrids);

  if (!canPlace) return [];

  unitCommand.targetWorldSpacePos = unit.pos;
  setPendingOrders(unit, unitCommand);
  addEarmark(data, data.getUnitTypeData(addOnType));

  return [unitCommand];
}

/**
 * Attempt to lift off the unit if it doesn't have pending orders.
 * @param {Unit} unit 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function attemptLiftOff(unit) {
  const { pos, tag } = unit; if (pos === undefined || tag === undefined) return [];
  const collectedActions = [];

  if (!unit.labels.has('pendingOrders')) {
    const addOnPosition = unit.labels.get('addAddOn');
    if (addOnPosition && getDistance(getAddOnPlacement(pos), addOnPosition) < 1) {
      unit.labels.delete('addAddOn');
    } else {
      unit.labels.set('addAddOn', null);
      const unitCommand = {
        abilityId: Ability.LIFT,
        unitTags: [tag],
      };
      collectedActions.push(unitCommand);
      setPendingOrders(unit, unitCommand);
    }
  }

  return collectedActions;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D | undefined} targetPosition
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function prepareUnitToBuildAddon(world, unit, targetPosition) {
  const { agent, data } = world;
  const { foodUsed } = agent; if (foodUsed === undefined) return [];
  const collectedActions = [];

  const currentFood = foodUsed;
  const unitBeingTrained = getUnitBeingTrained(unit); // Placeholder function, replace with your own logic
  const foodUsedByTrainingUnit = unitBeingTrained ? getFoodUsedByUnitType(data, unitBeingTrained) : 0;
  const gameState = GameState.getInstance();
  const plan = gameState.getPlanFoodValue(); // Function to get the plan's food value

  if (unit.isIdle() && getPendingOrders(unit).length === 0 && isStructureLifted(unit) && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    landCommand.targetWorldSpacePos = targetPosition;
    collectedActions.push(landCommand);
  }

  if (canStructureLiftOff(unit) && getPendingOrders(unit).length === 0) {
    const liftCommand = createUnitCommand(Ability.LIFT, [unit]);
    collectedActions.push(liftCommand);
  }

  if (isStructureLifted(unit) && getPendingOrders(unit).length === 0 && targetPosition) {
    const landCommand = createUnitCommand(Ability.LAND, [unit]);
    landCommand.targetWorldSpacePos = targetPosition;
    collectedActions.push(landCommand);
  }

  if (!unit.isIdle() && getPendingOrders(unit).length === 0 && (currentFood - foodUsedByTrainingUnit >= plan)) {
    const cancelCommand = createUnitCommand(Ability.CANCEL_QUEUE5, [unit]);
    collectedActions.push(cancelCommand);
  }

  return collectedActions;
}

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

// Export the function
module.exports = {
  attemptBuildAddOn,
  attemptLiftOff,
  calculateLiftLandAndMoveTime,
  prepareUnitToBuildAddon,
  seigeTanksSiegedGrids,
};