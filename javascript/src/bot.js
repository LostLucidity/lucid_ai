//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Race } = require('@node-sc2/core/constants/enums');

// Internal module imports
const { buildSupply, shouldTrainMoreWorkers, trainAdditionalWorkers, calculateMaxWorkers } = require('./economyManagement');
const GameState = require('./gameState');
const { logMessage, logError } = require('./logger');
const { prepareEarlyScouting } = require('./scoutingUtils');
const { refreshProductionUnitsCache } = require('./unitManagement');
const { assignWorkers, balanceWorkerDistribution, reassignIdleWorkers } = require('./workerAssignment');
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
   * Handler for each game step. This function orchestrates various actions based on the current game state.
   * It updates worker distribution, builds supply structures if needed, and trains additional workers.
   * Future enhancements can include logic for scouting, unit production, tech upgrades, and other strategic actions.
   * 
   * @param {World} world - The game context, including resources and actions.
   */
  async onStep(world) {
    // Refresh production units cache
    refreshProductionUnitsCache();

    const { units, actions } = world.resources.get();
    const { agent } = world;

    // Update worker counts
    totalWorkers = units.getWorkers().length;
    updateMaxWorkers(units);

    // Collect actions for batch processing
    const actionCollection = [
      ...balanceWorkerDistribution(units, world.resources),
      ...buildSupply(world),
    ];

    // Additional worker training
    if (shouldTrainMoreWorkers(totalWorkers, maxWorkers)) {
      actionCollection.push(...trainAdditionalWorkers(world, agent, units.getBases()));
    }

    // Reassign idle workers
    reassignIdleWorkers(world);

    // Send collected actions in a batch
    try {
      if (actionCollection.length > 0) {
        await actions.sendAction(actionCollection);
      }
    } catch (error) {
      console.error('Error sending actions:', error);
    }
  }
,

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
