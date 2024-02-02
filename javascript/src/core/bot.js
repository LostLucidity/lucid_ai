//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');

// Internal module imports
const GameState = require('./gameState');
const logger = require('./logger');
const config = require('../../config/config');
const StrategyService = require('../buildOrders/strategy/strategyService');
const buildingService = require('../construction/buildingService');
const economyManagement = require('../economyManagement');
const onGameStart = require('../events/onGameStart');
const unitManagement = require('../unitManagement');
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

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  interface: {
    raw: true, rawCropToPlayableArea: true, score: true, showBurrowedShadows: true, showCloaked: true
  },

  async onGameStart(world) {
    await onGameStart(world);
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
