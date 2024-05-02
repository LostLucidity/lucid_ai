//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
// Internal module imports

const logger = require('./utils/logger');
const config = require('../../config/config');
const ActionCollector = require('../features/actions/actionCollector');
const { clearAllPendingOrders } = require('../gameLogic/utils/gameMechanics/unitUtils');
const { GameState } = require('../gameState');
const GameInitialization = require('../initialization/GameInitialization');

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
    const gameInit = new GameInitialization(world);
    await gameInit.enhancedOnGameStart();
  },

  /**
   * Main game loop function called on each step of the game.
   * @param {World} world - The current game world state.
   */
  onStep: async (world) => {
    const actionCollector = new ActionCollector(world);
    const actions = actionCollector.collectActions();
    await executeActions(world, actions);
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
