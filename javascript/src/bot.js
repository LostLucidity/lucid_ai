//@ts-check
"use strict"

const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const config = require('../config/config');
const GameState = require('./gameState');
const { assignWorkersToMinerals } = require('./workerAssignment');
const { logMessage, logError } = require('./logger');
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { Race } = require('@node-sc2/core/constants/enums');

// Instantiate the game state manager
const gameState = new GameState();

/** @type {number} Variable to store the bot's race */
let botRace;

/** @type {number} Track the total number of workers */
let totalWorkers = 0;

/** @type {number} Maximum number of workers */
let maxWorkers = 0;

/**
 * Updates the maximum number of workers based on current game conditions.
 * @param {UnitResource} units - The units resource object from the bot.
 */
function updateMaxWorkers(units) {
  maxWorkers = calculateMaxWorkers(units);
}

/**
 * Calculates the maximum number of workers based on current game conditions.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {number} - The calculated maximum number of workers.
 */
function calculateMaxWorkers(units) {
  const bases = units.getBases().length;
  // Adjust worker count per base for better efficiency
  return bases * 22; // Example: 22 workers per base
}

/**
 * Checks if a base is saturated with workers.
 * @param {Unit} base - The base to check for saturation.
 * @returns {boolean} - True if the base is saturated, false otherwise.
 */
function isBaseSaturated(base) {
  const idealHarvesters = base.idealHarvesters || 0;
  const assignedHarvesters = base.assignedHarvesters || 0;
  return assignedHarvesters >= idealHarvesters;
}

/**
 * Trains a worker at the specified base.
 * @param {Unit} base - The base to train the worker at.
 * @param {number} workerType - The type ID of the worker unit to train.
 * @param {ActionManager} actions - The actions object from the bot.
 */
async function trainWorker(base, workerType, actions) {
  try {
    await actions.train(workerType, base);
    totalWorkers++;
  } catch (error) {
    logError('Error in training worker:', error);
  }
}

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  /**
   * Handler for game start events.
   * @param {World} world - The game context, including resources and actions.
   */
  async onGameStart(world) {
    logMessage('Game Started', 1);

    // Determine the bot's race at the start of the game
    botRace = (typeof world.agent.race !== 'undefined') ? world.agent.race : Race.TERRAN;

    // Assign initial workers to mineral fields
    const { units, actions } = world.resources.get();
    const workers = units.getWorkers();
    const mineralFields = units.getMineralFields();

    if (workers.length && mineralFields.length) {
      try {
        assignWorkersToMinerals(workers, mineralFields, actions);
      } catch (error) {
        logError('Error in assigning workers to minerals:', error);
      }
    } else {
      logError('Error: Workers or mineral fields are undefined or empty');
    }

    // TODO: Implement initial scouting or base expansion logic
  },

  /**
   * Handler for each game step.
   * @param {World} world - The game context, including resources and actions.
   */
  async onStep(world) {
    const { units, actions } = world.resources.get();

    updateMaxWorkers(units);

    if (totalWorkers < maxWorkers) {
      const mainBases = units.getBases();
      for (const base of mainBases) {
        if (base.isIdle() && !isBaseSaturated(base)) {
          const workerType = WorkerRace[botRace];
          if (workerType) {
            await trainWorker(base, workerType, actions);
          }
        }
      }
    }

    // TODO: Implement advanced strategies like scouting, tech upgrades, army management, etc.
    // TODO: Efficiently manage resources and plan expansions
  },

  /**
   * Handler for game end events.
   */
  async onGameEnd() {
    logMessage('Game has ended', 1);
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
  logError('Error in connecting to the engine or starting the game:', err);
});

module.exports = bot;
