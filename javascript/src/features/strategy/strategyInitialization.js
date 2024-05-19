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
  const resourceManager = world.resources;
  return assignWorkers(resourceManager);
}

/**
 * Initializes the strategy manager and assigns initial workers.
 * 
 * @param {World} world - The game world context.
 * @param {SC2APIProtocol.Race} botRace - The race of the bot.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} The actions to assign initial workers.
 */
function initializeStrategyAndAssignWorkers(world, botRace) {
  const strategyManager = StrategyManager.getInstance(botRace);
  const strategyContext = StrategyContext.getInstance();
  const gameState = GameState.getInstance();

  if (!strategyContext.getCurrentStrategy()) {
    strategyManager.initializeStrategy(botRace);
  }

  const buildOrder = strategyManager.getBuildOrderForCurrentStrategy();
  if (buildOrder && buildOrder.steps) {
    const maxSupply = strategyUtils.getMaxSupplyFromPlan(buildOrder.steps, botRace);
    config.planMax = { supply: maxSupply, gasMine: 0 };
    gameState.setPlan(strategyUtils.convertToPlanSteps(buildOrder.steps));

    // Enhance build order steps with a completed flag
    const enhancedBuildOrder = buildOrder.steps.map(step => ({
      ...step,
      completed: false
    }));

    gameState.setBuildOrder(enhancedBuildOrder);
  }

  return assignInitialWorkers(world);
}

module.exports = { initializeStrategyAndAssignWorkers };
