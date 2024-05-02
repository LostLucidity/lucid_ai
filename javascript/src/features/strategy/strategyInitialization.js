// strategyInitialization.js

const StrategyContext = require('./strategyContext');
const config = require('../../../config/config');
const StrategyManager = require('../../features/strategy/strategyManager');
const strategyUtils = require('../../features/strategy/strategyUtils');
const { assignWorkers } = require('../../gameLogic/utils/gameMechanics/workerUtils');
const { GameState } = require('../../gameState');

/**
 * Prepares the initial worker assignments to mineral fields.
 * Returns the actions to be executed, without directly sending them.
 * 
 * @param {World} world - The game world context, including resources and actions.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The collection of actions to be executed.
 */
function assignInitialWorkers(world) {
  // Retrieve the resource manager from the world object
  const resourceManager = world.resources;

  // Generate actions for assigning workers
  const workerActions = assignWorkers(resourceManager);

  // Return the collection of actions without sending them
  return workerActions;
}

/**
 * Initializes the strategy manager and assigns initial workers.
 * 
 * @param {World} world - The game world context.
 * @param {SC2APIProtocol.Race} botRace - The race of the bot.
 */
function initializeStrategyAndAssignWorkers(world, botRace) {
  const strategyManager = StrategyManager.getInstance(botRace);
  if (!StrategyContext.getInstance().getCurrentStrategy()) {
    strategyManager.initializeStrategy(botRace);
  }

  const buildOrder = strategyManager.getBuildOrderForCurrentStrategy();
  if (buildOrder && buildOrder.steps) {
    const maxSupply = strategyUtils.getMaxSupplyFromPlan(buildOrder.steps, botRace);
    config.planMax = { supply: maxSupply, gasMine: 0 };
    GameState.getInstance().setPlan(strategyUtils.convertToPlanSteps(buildOrder.steps));
  }

  // Return worker actions for the caller to execute
  return assignInitialWorkers(world);
}

module.exports = { initializeStrategyAndAssignWorkers };
