//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
// Internal module imports

const cacheManager = require('./utils/cache');
const logger = require('./utils/logger');
const config = require('../../config/config');
const ActionCollector = require('../features/actions/actionCollector');
const { clearAllPendingOrders } = require('../gameLogic/utils/gameMechanics/unitUtils');
const { GameState } = require('../gameState');
const GameInitialization = require('../initialization/GameInitialization');

const completedBasesMap = new Map();

// Instantiate the game state manager
const gameState = GameState.getInstance();

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
    let updateNeeded = false;
    const bases = world.resources.get().units.getBases();

    for (const base of bases) {
      if ((base.buildProgress ?? 0) >= 1 && !completedBasesMap.get(base.tag)) {
        completedBasesMap.set(base.tag, true);
        updateNeeded = true;
      }
    }

    if (updateNeeded) {
      const completedBases = bases.filter(base => completedBasesMap.get(base.tag));
      cacheManager.updateCompletedBasesCache(completedBases);
      cacheManager.resetUpdateNeededFlag();  // Reset flag after cache update
    }

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
