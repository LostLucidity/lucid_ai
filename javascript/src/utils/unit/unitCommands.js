// unitCommands.js

const { Ability } = require("@node-sc2/core/constants");

const { setRepositionLabel } = require("./unitUtils");
const { checkAddOnPlacement } = require("../../core/services/ConstructionSpatialService");
const { createUnitCommand } = require("../common/common");
const { setPendingOrders } = require("../unitManagement/unitOrders");

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
 * Handles training commands for WARPGATE trainers.
 * @param {World} world The game world context.
 * @param {Unit} trainer The WARPGATE training unit.
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData Data about the unit type being trained.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} Training commands for this trainer.
 */
function handleWarpGateTrainer(world, trainer, unitTypeData) {
  // Ensure we have a valid ability ID to proceed
  const abilityId = unitTypeData.abilityId;
  if (!abilityId) return [];

  // Check if the trainer has a defined tag before creating the command
  if (typeof trainer.tag === 'undefined') {
    console.error('Undefined trainer tag encountered');
    return [];
  }

  // Example placeholder logic for warpgate training
  return [{
    abilityId: abilityId,
    unitTags: [trainer.tag],  // Now safely adding the tag after the check
    queueCommand: true  // Assuming WARPGATEs also queue commands
  }];
}

/**
 * @param {Unit} worker 
 * @param {Unit} target 
 * @param {boolean} queue 
 * @returns {SC2APIProtocol.ActionRawUnitCommand}
 * Generates a command for a worker unit to mine from a specified target.
 */
function mine(worker, target, queue = true) {
  const unitCommand = createUnitCommand(Ability.HARVEST_GATHER, [worker], queue);
  unitCommand.targetUnitTag = target.tag;
  setPendingOrders(worker, unitCommand);
  return unitCommand;
}

module.exports = {
  createMoveCommand,
  handleNonWarpgateTrainer,
  handleWarpGateTrainer,
  mine
};
