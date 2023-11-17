//@ts-check
"use strict"

const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const config = require('../config/config');
const GameState = require('./gameState');
const { assignWorkersToMinerals } = require('./workerAssignment');
const { logMessage, logError } = require('./logger');

// Instantiate the game state manager
const gameState = new GameState();

/**
 * Create a new StarCraft II bot agent with event handlers.
 */
const bot = createAgent({

  /**
   * Handler for game start events.
   * @param {World} world - The game context, including resources and actions.
   */
  async onGameStart({ resources }) {
    logMessage('Game Started', 1);
    const { units, actions } = resources.get();
    const workers = units.getWorkers();
    const mineralFields = units.getMineralFields();

    // Validate data before processing
    if (workers.length && mineralFields.length) {
      try {
        assignWorkersToMinerals(workers, mineralFields, actions);
      } catch (error) {
        logError('Error in assigning workers to minerals:', error);
      }
    } else {
      logError('Error: Workers or mineral fields are undefined or empty');
    }
  },

  /**
   * Handler for game end events.
   */
  async onGameEnd() {
    logMessage('Game has ended', 1);

    // Call the resetBotState function to reset the bot's state
    resetBotState();
  }
});

/**
 * Resets the state of the bot.
 */
function resetBotState() {
  logMessage('Resetting bot state...', 2);
  gameState.reset();
}

// Create the game engine
const engine = createEngine();

// Connect to the engine and run the game
engine.connect().then(() => {
  return engine.runGame(config.defaultMap, [
    createPlayer({ race: config.defaultRace }, bot),
    createPlayer({ race: config.defaultRace, difficulty: config.defaultDifficulty }),
  ]);
}).catch(err => {
  logError('Error in connecting to the engine or starting the game:', err);
});

// Export the bot for testing or further development
module.exports = bot;
