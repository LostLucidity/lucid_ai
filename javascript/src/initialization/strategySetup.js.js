// strategyInitialization.js

const config = require('../../config/config');
const StrategyContext = require('../features/strategy/strategyContext');
const StrategyManager = require('../features/strategy/strategyManager');
const { GameState } = require('../gameState');
const strategyUtils = require('../utils/strategyUtils');
const { assignWorkers } = require('../utils/workerUtils');

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
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} The actions to assign initial workers.
 */
async function setupStrategyAndWorkers(world, botRace) {
  const strategyContext = StrategyContext.getInstance();

  // Early return if the current strategy is already set
  if (strategyContext.getCurrentStrategy()) {
    return assignInitialWorkers(world);
  }

  const strategyManager = StrategyManager.getInstance(botRace);
  const gameState = GameState.getInstance();

  await strategyManager.initializeStrategy(botRace); // Await the asynchronous initialization

  const buildOrder = strategyManager.getBuildOrderForCurrentStrategy();
  if (buildOrder && buildOrder.steps) {
    const maxSupply = strategyUtils.getMaxSupplyFromPlan(buildOrder.steps, botRace);
    config.planMax = { supply: maxSupply, gasMine: 0 };
    gameState.setPlan(strategyUtils.convertToPlanSteps(buildOrder.steps));

    // Enhance build order steps with a completed flag
    const flaggedBuildOrder = buildOrder.steps.map(step => ({
      ...step,
      completed: false
    }));

    gameState.setBuildOrder(flaggedBuildOrder);
  }

  return assignInitialWorkers(world);
}

module.exports = { setupStrategyAndWorkers };
