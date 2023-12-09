//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Race } = require('@node-sc2/core/constants/enums');
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

// Internal module imports
const { trainWorker, buildSupply } = require('./economyManagement');
const GameState = require('./gameState');
const { logMessage, logError } = require('./logger');
const { prepareEarlyScouting } = require('./scoutingUtils');
const { refreshProductionUnitsCache } = require('./unitManagement');
const { assignWorkers, balanceWorkerDistribution } = require('./workerAssignment');
const config = require('../config/config');

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

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  async onGameStart(world) {
    logMessage('Game Started', 1);

    // Determine the bot's race at the start of the game
    botRace = (typeof world.agent.race !== 'undefined') ? world.agent.race : Race.TERRAN;

    // Retrieve initial units and resources
    const { units, actions } = world.resources.get();
    const workers = units.getWorkers();
    const mineralFields = units.getMineralFields();

    // Initialize an array to collect actions
    const actionCollection = [];

    // Check if workers and mineral fields are available
    if (workers.length && mineralFields.length) {
      try {
        // Assign workers to mineral fields for initial resource gathering
        const workerActions = assignWorkers(world.resources);
        actionCollection.push(...workerActions); // Collect actions instead of sending immediately

        // Prepare for early game scouting
        const scoutingActions = prepareEarlyScouting(world); // Modified function to collect actions
        actionCollection.push(...scoutingActions);

        // Send all collected actions in a batch
        await actions.sendAction(actionCollection);
      } catch (error) {
        // Log any errors encountered during the initial setup
        logError('Error in assigning workers to minerals or scouting:', error);
      }
    } else {
      // Log an error if workers or mineral fields are undefined or empty
      logError('Error: Workers or mineral fields are undefined or empty');
    }
  },

  /**
   * Handler for each game step.
   * @param {World} world - The game context, including resources and actions.
   */
  async onStep(world) {
    // Refresh the production units cache
    refreshProductionUnitsCache();
    
    const { units, actions } = world.resources.get();
    const { agent } = world; // Corrected access to agent

    // Calculate the total number of workers
    totalWorkers = units.getWorkers().length;

    // Initialize an array to collect actions
    const actionCollection = [];

    // Update the maximum number of workers based on the current game state
    updateMaxWorkers(units);

    // Balance worker distribution across all bases
    const workerDistributionActions = balanceWorkerDistribution(units, world.resources);
    actionCollection.push(...workerDistributionActions);

    // Check if supply is needed and if a supply unit is not currently being built
    const supplyActions = buildSupply(world);
    actionCollection.push(...supplyActions);

    // Check if more workers need to be trained based on the max worker count
    if (totalWorkers < maxWorkers) {
      const currentSupply = agent.foodUsed || 0;
      const supplyCap = agent.foodCap || 0;
      const supplyAvailable = supplyCap - currentSupply;

      const mainBases = units.getBases();
      for (const base of mainBases) {
        if (base.isIdle() && !isBaseSaturated(base) && supplyAvailable > 0) {
          const workerType = WorkerRace[botRace];
          if (workerType) {
            const workerTrainingActions = trainWorker(world);
            actionCollection.push(...workerTrainingActions);
          }
        }
      }
    }

    // TODO: Collect actions from additional logic for continuous scouting, unit production,
    //       tech upgrades, and other strategic actions.

    // Send all collected actions in a batch
    if (actionCollection.length > 0) {
      await actions.sendAction(actionCollection);
    }
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
