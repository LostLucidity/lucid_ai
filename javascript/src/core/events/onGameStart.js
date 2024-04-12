// src/core/events/onGameStart.js
const { Race } = require('@node-sc2/core/constants/enums');

const config = require('../../../config/config');
const BuildingPlacement = require('../../features/construction/buildingPlacement');
const StrategyManager = require('../../features/strategy/strategyManager');
const strategyUtils = require('../../features/strategy/strategyUtils');
const sharedWorkerUtils = require('../../gameLogic/sharedWorkerUtils');
const stateManagement = require('../../gameLogic/stateManagement');
const { calculateAdjacentToRampGrids } = require('../../utils/pathfinding/pathfinding');
const { setUnitTypeTrainingAbilityMapping } = require('../../utils/training/unitConfig');
const GameState = require('../gameState');
const logger = require('../../utils/core/logger');

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
  const workerActions = sharedWorkerUtils.assignWorkers(resourceManager);

  // Return the collection of actions without sending them
  return workerActions;
}

/**
 * Initializes the game state, setting the race, and mapping unit types.
 * 
 * @param {World} world - The game world context.
 * @param {Race} botRace - The race of the bot.
 */
function initializeGameState(world, botRace) {
  const gameState = GameState.getInstance();
  gameState.setRace(botRace);
  setUnitTypeTrainingAbilityMapping(world.data);
  gameState.initializeStartingUnitCounts(botRace);
  gameState.verifyStartingUnitCounts(world);
}

/**
 * Initializes the strategy manager and assigns initial workers.
 * 
 * @param {World} world - The game world context.
 * @param {Race} botRace - The race of the bot.
 */
function initializeStrategyAndAssignWorkers(world, botRace) {
  const strategyManager = StrategyManager.getInstance(botRace);
  if (!strategyManager.getCurrentStrategy()) {
    strategyManager.initializeStrategy(botRace);
  }

  const buildOrder = strategyManager.getBuildOrderForCurrentStrategy(world);
  if (buildOrder && buildOrder.steps) {
    const maxSupply = strategyUtils.getMaxSupplyFromPlan(buildOrder.steps, botRace);
    config.planMax = { supply: maxSupply, gasMine: 0 };
    GameState.getInstance().setPlan(strategyUtils.convertToPlanSteps(buildOrder.steps));
  }

  // Return worker actions for the caller to execute
  return assignInitialWorkers(world);
}

/**
 * Handles the initial actions to be taken when the game starts.
 * Initializes game state, strategy, and performs initial map analysis.
 * 
 * @param {World} world - The game world context.
 */
async function onGameStart(world) {
  logger.logMessage('Game Started', 1);

  try {
    const botRace = stateManagement.determineBotRace(world);
    initializeGameState(world, botRace);
    const workerActions = initializeStrategyAndAssignWorkers(world, botRace);
    await world.resources.get().actions.sendAction(workerActions);
    performInitialMapAnalysis(world, botRace);
    // Execute any other necessary actions based on the results from performInitialMapAnalysis
  } catch (error) {
    logger.logError('Error during game start initialization:', error instanceof Error ? error : new Error('Unknown error'));
  }
}

/**
 * Performs initial map analysis based on the bot's race.
 * This includes calculating grid positions adjacent to ramps and determining wall-off positions.
 * 
 * @param {World} world - The game world context.
 * @param {Race} botRace - The race of the bot, used to determine specific actions like wall-off positions for Terran.
 */
function performInitialMapAnalysis(world, botRace) {
  // This function should only calculate data and return it if necessary
  if (botRace === Race.TERRAN) {
    const map = world.resources.get().map;
    // Possibly return calculated positions or other relevant data
    return {
      rampGrids: calculateAdjacentToRampGrids(map),
      wallOffPositions: BuildingPlacement.calculateWallOffPositions(world)
    };
  }
  return null; // Return null or appropriate value if no analysis is performed
}

module.exports = onGameStart;