// trainingCommands.js

const { UnitType } = require("@node-sc2/core/constants");

const { handleNonWarpgateTrainer, handleWarpGateTrainer } = require("./unitCommands");

/**
 * Creates training commands for a list of trainers.
 * @param {World} world The game world context.
 * @param {Unit[]} trainers List of units that can train others.
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData Data about the unit type being trained.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of training commands.
 */
function createTrainingCommands(world, trainers, unitTypeData) {
  return trainers.flatMap(trainer => {
    if (trainer.unitType !== UnitType.WARPGATE) {
      // Handle regular trainers
      return handleNonWarpgateTrainer(world, trainer, unitTypeData);
    } else {
      // Optionally handle WARPGATE specifically, if needed
      // Placeholder return for illustration, assuming handleWarpGateTrainer function exists
      return handleWarpGateTrainer(world, trainer, unitTypeData);
    }
  });
}

module.exports = {
  createTrainingCommands
};
