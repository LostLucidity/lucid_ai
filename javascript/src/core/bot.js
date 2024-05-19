//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
// Internal module imports

const cacheManager = require('./utils/cache');
const logger = require('./utils/logger');
const config = require('../../config/config');
const ActionCollector = require('../features/actions/actionCollector');
const StrategyManager = require('../features/strategy/strategyManager');
const { clearAllPendingOrders } = require('../gameLogic/utils/gameMechanics/unitUtils');
const { GameState } = require('../gameState');
const GameInitialization = require('../initialization/GameInitialization');

const buildOrderCompletion = new Map();

const completedBasesMap = new Map();

// Instantiate the game state manager
const gameState = GameState.getInstance();

/**
 * Checks and updates the build order progress.
 * @param {World} world - The current game world state.
 * @param {import('./utils/globalTypes').BuildOrderStep[]} buildOrder - The build order to track and update.
 */
async function checkBuildOrderProgress(world, buildOrder) {
  const currentTime = world.resources.get().frame.getGameLoop();
  const BUFFER_TIME_SECONDS = 15; // 15 seconds buffer time
  const BUFFER_TIME_TICKS = BUFFER_TIME_SECONDS * 22.4; // Convert buffer time to game ticks

  buildOrder.forEach(order => {
    let orderStatus = buildOrderCompletion.get(order);

    // Initialize status if not already present
    if (!orderStatus) {
      orderStatus = { completed: false, logged: false };
      buildOrderCompletion.set(order, orderStatus);
    }

    if (!orderStatus.completed) {
      const satisfied = StrategyManager.getInstance().isStepSatisfied(world, order);
      if (satisfied) {
        orderStatus.completed = true;
        console.log(`Build Order Step Completed: Supply-${order.supply} Time-${order.time} Action-${order.action}`);
      } else {
        // Convert order.time to game ticks using the utility function
        const expectedTimeInTicks = timeStringToGameTicks(order.time);

        // Log an alert if the current time has exceeded the expected time plus buffer time for this step and it hasn't been logged yet
        if (expectedTimeInTicks + BUFFER_TIME_TICKS < currentTime && !orderStatus.logged) {
          console.warn(`Build Order Step NOT Completed: Supply-${order.supply} Time-${order.time} Action-${order.action}. Expected by time ${order.time}, current time is ${(currentTime / 22.4).toFixed(2)} seconds.`);
          orderStatus.logged = true;
        }
      }
    }
  });
}

/**
 * Executes collected actions and handles any errors.
 * @param {World} world - The current game world state.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionCollection - Actions to be executed.
 */
async function executeActions(world, actionCollection) {
  if (actionCollection.length > 0) {
    try {
      await world.resources.get().actions.sendAction(actionCollection);
      clearAllPendingOrders(world.resources.get().units.getAll());
    } catch (error) {
      console.error('Error sending actions in onStep:', error);
    }
  }
}

/**
 * Converts a time string in "minutes:seconds" format to game ticks.
 * @param {string} time - The time string to convert.
 * @returns {number} - The equivalent game ticks.
 */
function timeStringToGameTicks(time) {
  const [minutes, seconds] = time.split(':').map(Number);
  return (minutes * 60 + seconds) * 22.4;
}


// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  interface: {
    raw: true, rawCropToPlayableArea: true, score: true, showBurrowedShadows: true, showCloaked: true
  },

  onGameStart: async (world) => {
    try {
      // Initialize game settings
      const gameInit = new GameInitialization(world);
      await gameInit.enhancedOnGameStart();
    } catch (error) {
      console.error('Failed during game initialization:', error);
      // Consider whether to throw the error or handle it to allow continuation if possible
    }

    try {
      // Update cache for completed bases
      const bases = world.resources.get().units.getBases();
      const completedBases = bases.filter(base => base.buildProgress && base.buildProgress >= 1);
      cacheManager.updateCompletedBasesCache(completedBases);
    } catch (error) {
      console.error('Failed to update cache for completed bases:', error);
      // Additional handling or recovery logic could go here
    }
  },

  /**
   * Main game loop function called on each step of the game.
   * @param {World} world - The current game world state.
   */
  onStep: async (world) => {
    const bases = world.resources.get().units.getBases();
    const completedBases = [];

    for (const base of bases) {
      if ((base.buildProgress ?? 0) >= 1 && !completedBasesMap.get(base.tag)) {
        completedBasesMap.set(base.tag, true);
        completedBases.push(base);
      }
    }

    if (completedBases.length > 0) {
      cacheManager.updateCompletedBasesCache(completedBases);
    }

    const buildOrder = gameState.getBuildOrder();
    await checkBuildOrderProgress(world, buildOrder);

    try {
      const actionCollector = new ActionCollector(world);
      const actions = actionCollector.collectActions();
      await executeActions(world, actions);
    } catch (error) {
      console.error('Error during game step:', error);
    }
  },

  /**
   * Handler for game end events.
   */
  onGameEnd: async () => {
    logger.logMessage('Game has ended', 1);
    gameState.reset();
  },
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
