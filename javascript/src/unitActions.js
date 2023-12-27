//@ts-check
"use strict";

// External library imports
const { Ability } = require("@node-sc2/core/constants");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const GameState = require("./gameState");
const { getDistance } = require("./geometryUtils");
const { pointsOverlap } = require("./mapUtils");
const { getAddOnPlacement } = require("./placementUtils");
const { addEarmark } = require("./resourceUtils");
const { getUnitBeingTrained, isStructureLifted, canStructureLiftOff } = require("./unitHelpers");
const { setPendingOrders } = require("./unitOrders");
const { getFoodUsedByUnitType, createUnitCommand } = require("./utils");
const { getPendingOrders } = require("./utils/commonGameUtils");

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
 * @param {Unit} worker 
 * @param {Unit} target 
 * @param {boolean} queue 
 * @returns {SC2APIProtocol.ActionRawUnitCommand}
 */
const mine = (worker, target, queue = true) => {
  const unitCommand = createUnitCommand(Ability.HARVEST_GATHER, [worker], queue);
  unitCommand.targetUnitTag = target.tag;
  setPendingOrders(worker, unitCommand);
  return unitCommand;
};

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D | undefined} targetPosition
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function prepareUnitToBuildAddon(world, unit, targetPosition) {
  const { agent, data } = world;
  const { foodUsed } = agent;
  if (foodUsed === undefined) return [];

  const collectedActions = [];

  const currentFood = foodUsed;
  const unitBeingTrained = getUnitBeingTrained(unit); // Placeholder function
  const foodUsedByTrainingUnit = unitBeingTrained ? getFoodUsedByUnitType(data, unitBeingTrained) : 0;

  // Retrieve the race from the world object
  const race = world.agent.race; // Assuming world.agent.race holds the race information
  const gameState = GameState.getInstance();

  // Pass the race when calling getPlanFoodValue
  const plan = gameState.getPlanFoodValue(race);

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

// Export the function
module.exports = {
  attemptBuildAddOn,
  attemptLiftOff,
  mine,
  prepareUnitToBuildAddon,
  seigeTanksSiegedGrids,
};