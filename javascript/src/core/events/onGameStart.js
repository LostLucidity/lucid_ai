// src/events/onGameStart.js
const { Race } = require('@node-sc2/core/constants/enums');

const config = require('../../../config/config');
const BuildingPlacement = require('../../features/construction/buildingPlacement');
const StrategyManager = require('../../features/strategy/strategyManager');
const strategyUtils = require('../../features/strategy/strategyUtils');
const mapUtils = require('../../utils/common/mapUtils');
const sharedWorkerUtils = require('../../utils/gameLogic/sharedWorkerUtils');
const stateManagement = require('../../utils/gameLogic/stateManagement');
const GameState = require('../gameState');
const logger = require('../logger');


/**
 * @param {World} world
 */
async function onGameStart(world) {
  logger.logMessage('Game Started', 1);

  const botRace = stateManagement.determineBotRace(world);
  const gameState = GameState.getInstance();
  gameState.setRace(botRace);

  const strategyManager = StrategyManager.getInstance(botRace);
  if (!strategyManager.getCurrentStrategy()) {
    strategyManager.initializeStrategy(botRace);
  }

  try {
    const buildOrder = strategyManager.getBuildOrderForCurrentStrategy(world);
    const maxSupply = strategyUtils.getMaxSupplyFromPlan(buildOrder.steps, botRace);
    config.planMax = { supply: maxSupply, gasMine: 0 }; // Assuming 0 is a sensible default for gasMine

    const currentStrategy = strategyManager.getCurrentStrategy();
    if (currentStrategy?.steps) {
      gameState.setPlan(strategyUtils.convertToPlanSteps(currentStrategy.steps));
    }
  } catch (error) {
    logger.logError('Error during strategy setup:', error instanceof Error ? error : new Error('Unknown error'));
  }

  performInitialMapAnalysis(world);
  gameState.initializeStartingUnitCounts(botRace);
  gameState.verifyStartingUnitCounts(world);

  try {
    const actionCollection = assignInitialWorkers(world);
    const { actions } = world.resources.get();
    await actions.sendAction(actionCollection);
  } catch (error) {
    logger.logError('Error during initial worker assignment:', error instanceof Error ? error : new Error('Unknown error'));
  }
}

module.exports = onGameStart;

/**
 * Assigns initial workers to mineral fields and prepares for scouting.
 * @param {World} world - The game world context, including resources and actions.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The collection of actions to be executed.
 */
function assignInitialWorkers(world) {
  // Retrieve the resource manager from the world object
  const resourceManager = world.resources;

  // Initialize an array to collect actions
  const actionCollection = [];

  // Assign workers to mineral fields
  const workerActions = sharedWorkerUtils.assignWorkers(resourceManager); // Pass the ResourceManager object
  actionCollection.push(...workerActions);

  // Return the collection of actions
  return actionCollection;
}

/**
 * Performs initial map analysis based on the bot's race.
 * @param {World} world - The game world context.
 */
function performInitialMapAnalysis(world) {
  const botRace = stateManagement.determineBotRace(world);
  const map = world.resources.get().map;
  StrategyManager.getInstance(botRace);
  if (botRace === Race.TERRAN) {
    // First calculate the grids adjacent to ramps
    mapUtils.calculateAdjacentToRampGrids(map);

    // Then calculate wall-off positions using the calculated ramp grids
    BuildingPlacement.calculateWallOffPositions(world);
  }
}