//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Race } = require('@node-sc2/core/constants/enums');

// Internal module imports
const GameState = require('./gameState');
const logger = require('./logger');
const config = require('../../config/config');
const StrategyManager = require('../buildOrders/strategy/strategyManager');
const StrategyService = require('../buildOrders/strategy/strategyService');
const strategyUtils = require('../buildOrders/strategy/strategyUtils');
const BuildingPlacement = require('../construction/buildingPlacement');
const buildingService = require('../construction/buildingService');
const economyManagement = require('../economyManagement');
const mapUtils = require('../mapUtils');
const unitManagement = require('../unitManagement');
const gameStateHelpers = require('../utils/gameLogic/gameStateHelpers');
const sharedWorkerUtils = require('../utils/gameLogic/sharedWorkerUtils');
const { clearAllPendingOrders } = require('../utils/gameLogic/unitOrderUtils');
const workerAssignment = require('../workerAssignment');

// Instantiate the game state manager
const gameState = new GameState();

/** @type {number} Maximum number of workers */
let maxWorkers = 0;

/**
 * Updates the maximum number of workers based on current game conditions.
 * @param {UnitResource} units - The units resource object from the bot.
 */
function updateMaxWorkers(units) {
  maxWorkers = economyManagement.calculateMaxWorkers(units);
}

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
  const botRace = gameStateHelpers.determineBotRace(world);
  const map = world.resources.get().map;
  StrategyManager.getInstance(botRace);
  if (botRace === Race.TERRAN) {
    // First calculate the grids adjacent to ramps
    mapUtils.calculateAdjacentToRampGrids(map);

    // Then calculate wall-off positions using the calculated ramp grids
    BuildingPlacement.calculateWallOffPositions(world);
  }
}

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  interface: {
    raw: true, rawCropToPlayableArea: true, score: true, showBurrowedShadows: true, showCloaked: true
  },
  async onGameStart(world) {
    logger.logMessage('Game Started', 1);

    const botRace = gameStateHelpers.determineBotRace(world);
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
  },

  /**
   * Main game loop function called on each step of the game.
   * @param {World} world - The current game world state.
   */
  async onStep(world) {
    // Refresh production units cache
    unitManagement.refreshProductionUnitsCache();

    const { units } = world.resources.get();
    const strategyService = StrategyService.getInstance();

    // Update maximum worker count based on current game state
    updateMaxWorkers(units);

    let actionCollection = strategyService.runPlan(world); // Start with strategy plan actions

    // Only add additional actions if the strategy plan is not active
    if (!strategyService.isActivePlan()) {
      const additionalActions = [
        ...workerAssignment.balanceWorkerDistribution(world, units, world.resources),
        ...buildingService.buildSupply(world),
        ...(economyManagement.shouldTrainMoreWorkers(units.getWorkers().length, maxWorkers)
          ? economyManagement.trainAdditionalWorkers(world, world.agent, units.getBases())
          : []),
        ...workerAssignment.reassignIdleWorkers(world)
      ];

      // Combine the initial actions with the additional ones
      actionCollection = actionCollection.concat(additionalActions);
    }

    // Send collected actions in a batch if there are any
    if (actionCollection.length > 0) {
      try {
        await world.resources.get().actions.sendAction(actionCollection);
        // Clear pending orders after actions have been sent
        clearAllPendingOrders(units.getAll()); // Ensure getAll is defined and retrieves all relevant units
      } catch (error) {
        console.error('Error sending actions in onStep:', error);
      }
    }
  },

  /**
   * Handler for game end events.
   */
  async onGameEnd() {
    logger.logMessage('Game has ended', 1);
    gameState.reset();
  }
});

// Create the game engine
const engine = createEngine();

// Connect to the engine and run the game
engine.connect().then(() => {
  return engine.runGame(config.defaultMap, [
    createPlayer({ race: config.defaultRace }, bot),
    createPlayer({ race: config.defaultRace, difficulty: config.defaultDifficulty }),
  ]);
}).catch(err => {
  logger.logError('Error in connecting to the engine or starting the game:', err);
});

module.exports = bot;
