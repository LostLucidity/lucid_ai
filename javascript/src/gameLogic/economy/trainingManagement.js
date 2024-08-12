// src/gameLogic/economy/trainingManagement.js

const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { EarmarkManager } = require("../../core");
const { GameState } = require("../../state");
const { shouldTrainWorkers, trainWorkers, trainCombatUnits, earmarkWorkersForTraining } = require("../../units/management/training");

/**
 * Optimizes the training of units based on the current game state and strategic needs.
 * @param {World} world - The game world context.
 * @param {import("../../features/strategy/strategyManager").PlanStep} step - The current strategy step.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of unit training commands.
 */
function handleUnitTraining(world, step) {
  if (!world.agent.race || !step.unitType) return [];

  const gameState = GameState.getInstance();
  gameState.setFoodUsed(world);
  const foodUsed = gameState.getFoodUsed() + EarmarkManager.getEarmarkedFood();
  const foodAvailable = (step.food || 0) - foodUsed;

  if (foodAvailable <= 0) return [];

  let trainingOrders = shouldTrainWorkers(world) ? trainWorkers(world) : [];

  if (trainingOrders.length === 0) {
    trainingOrders = trainCombatUnits(world);
  }

  if (WorkerRace[world.agent.race]) {
    earmarkWorkersForTraining(world, foodAvailable);
  }

  return trainingOrders;
}

module.exports = {
  handleUnitTraining,
};
