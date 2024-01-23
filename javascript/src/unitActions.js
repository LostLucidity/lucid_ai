//@ts-check
"use strict";

// External library imports
const { Ability, UnitType } = require("@node-sc2/core/constants");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const GameState = require("./core/gameState");
const { getDistance } = require("./geometryUtils");
const { pointsOverlap } = require("./mapUtils");
const { getAddOnPlacement } = require("./placementUtils");
const { determineScoutingLocations, selectSCVForScouting } = require("./scoutingUtils");
const { getUnitBeingTrained, isStructureLifted, canStructureLiftOff, setRepositionLabel } = require("./unitHelpers");
const { setPendingOrders } = require("./unitOrders");
const { getFoodUsedByUnitType, createUnitCommand } = require("./utils");
const { getPendingOrders } = require("./utils/gameLogic/commonGameUtils");
const { getPlanFoodValue } = require("./utils/gameLogic/gameStrategyUtils");
const { checkAddOnPlacement, seigeTanksSiegedGrids } = require("./utils/gameLogic/sharedUnitPlacement");
const { getSingletonInstance } = require("./utils/gameLogic/singletonFactory");
const { addEarmark } = require("./utils/resourceManagement/resourceUtils");

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
 * Creates a move command for a unit to go to a specified location.
 * @param {number} unitId - The ID of the unit to move.
 * @param {Point2D} location - The destination location.
 * @returns {SC2APIProtocol.ActionRawUnitCommand} The move command for the unit.
 */
function createMoveCommand(unitId, location) {
  const MOVE_ABILITY_ID = Ability.MOVE; // Using the MOVE ability from the Ability module

  return {
    abilityId: MOVE_ABILITY_ID,
    targetWorldSpacePos: location,
    unitTags: [unitId.toString()], // Converting unitId to a string
    queueCommand: false
  };
}


/**
 * @param {World} world
 * @param {Unit[]} trainers
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 */
function createTrainingCommands(world, trainers, unitTypeData) {
  /**
   * @type {any[]}
   */
  const collectedActions = [];
  trainers.forEach(trainer => {
    if (trainer.unitType !== UnitType.WARPGATE) {
      const trainerActions = handleNonWarpgateTrainer(world, trainer, unitTypeData);
      collectedActions.push(...trainerActions);
    } else {
      // Handle WARPGATE case, potentially collecting actions
    }
  });
  return collectedActions;
}

/**
 * @param {World} world
 * @param {Unit} trainer
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 */
function handleNonWarpgateTrainer(world, trainer, unitTypeData) {
  const actions = [];
  if (trainer.isFlying) {
    const landingPosition = checkAddOnPlacement(world, trainer);
    if (landingPosition) {
      setRepositionLabel(trainer, landingPosition);
      const landCommand = createUnitCommand(Ability.LAND, [trainer], false, landingPosition);
      actions.push(landCommand);
    }
  } else {
    // Ensure that abilityId is defined before using it
    const abilityId = unitTypeData.abilityId;
    if (typeof abilityId !== 'undefined') {
      const trainCommand = createUnitCommand(abilityId, [trainer]);
      actions.push(trainCommand);
    } else {
      // Handle the undefined case, e.g., log an error or skip the action
      console.error('Ability ID is undefined for unit type', unitTypeData);
    }
  }
  return actions;
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

  // Retrieve the singleton instance of GameState
  const gameState = getSingletonInstance(GameState);
  // Pass the retrieved GameState instance
  const plan = getPlanFoodValue(gameState);

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
 * Performs the action of scouting with an SCV.
 * @param {World} world - The current world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions representing the scouting task.
 */
function performScoutingWithSCV(world) {
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  let actions = [];
  const scvId = selectSCVForScouting(world);

  // Determine multiple scouting locations
  const scoutingLocations = determineScoutingLocations(world);

  // Create move commands for the SCV to scout each location
  scoutingLocations.forEach(location => {
    const moveCommand = createMoveCommand(scvId, location);
    actions.push(moveCommand);
  });

  return actions;
}

// Export the function
module.exports = {
  attemptBuildAddOn,
  attemptLiftOff,
  createTrainingCommands,
  mine,
  performScoutingWithSCV,
  prepareUnitToBuildAddon,
  seigeTanksSiegedGrids,
};