//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Race } = require('@node-sc2/core/constants/enums');

// Internal module imports
const BuildingPlacement = require('./buildingPlacement');
const { buildSupply } = require('./buildingService');
const { shouldTrainMoreWorkers, trainAdditionalWorkers, calculateMaxWorkers } = require('./economyManagement');
const GameState = require('./gameState');
const { logMessage, logError } = require('./logger');
const { calculateAdjacentToRampGrids } = require('./mapUtils');
const { prepareEarlyScouting } = require('./scoutingUtils');
const { runPlan } = require('./strategyService');
const { refreshProductionUnitsCache, manageZergSupply } = require('./unitManagement');
const { assignWorkers, balanceWorkerDistribution, reassignIdleWorkers } = require('./workerAssignment');
const config = require('../config/config');

// Instantiate the game state manager
const gameState = new GameState();

/** @type {number} Variable to store the bot's race */
let botRace;

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
 * Performs initial map analysis based on the bot's race.
 * @param {World} world - The game world context.
 */
function performInitialMapAnalysis(world) {
  botRace = world.agent.race || Race.TERRAN;
  const map = world.resources.get().map;

  if (botRace === Race.TERRAN) {
    // First calculate the grids adjacent to ramps
    calculateAdjacentToRampGrids(map);

    // Then calculate wall-off positions using the calculated ramp grids
    BuildingPlacement.calculateWallOffPositions(world);
  }
  // Additional map analysis for other races can be added here
}

/**
 * Assigns initial workers to mineral fields and prepares for scouting.
 * @param {World} world - The game world context, including resources and actions.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The collection of actions to be executed.
 */
function assignInitialWorkersAndScout(world) {
  // Retrieve the resource manager from the world object
  const resourceManager = world.resources;

  // Initialize an array to collect actions
  const actionCollection = [];

  // Assign workers to mineral fields
  const workerActions = assignWorkers(resourceManager); // Pass the ResourceManager object
  actionCollection.push(...workerActions);

  // Prepare for early game scouting
  const scoutingActions = prepareEarlyScouting(world); // Pass the world object
  actionCollection.push(...scoutingActions);

  // Return the collection of actions
  return actionCollection;
}

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  async onGameStart(world) {
    logMessage('Game Started', 1);

    // Determine the bot's race at the start of the game (default to Terran if undefined)
    botRace = world.agent.race || Race.TERRAN;

    // Perform initial map analysis based on the bot's race
    performInitialMapAnalysis(world);

    // Initialize an array to collect actions
    const actionCollection = [];

    try {
      // Assign workers and prepare for scouting
      const initialActions = assignInitialWorkersAndScout(world);
      actionCollection.push(...initialActions);

      // Send all collected actions in a batch
      const { actions } = world.resources.get();
      await actions.sendAction(actionCollection);
    } catch (error) {
      // Check if error is an instance of Error
      if (error instanceof Error) {
        logError('Error during initial setup:', error);
      } else {
        // Handle cases where the error is not an Error instance
        logError('An unknown error occurred during initial setup');
      }
    }
  },

  async onStep(world) {
    // Refresh production units cache
    refreshProductionUnitsCache();

    const { units, actions } = world.resources.get();
    const { agent } = world;

    // Update worker counts
    let totalWorkers = units.getWorkers().length;
    updateMaxWorkers(units);

    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    let actionCollection = [];

    // Execute the game plan and collect actions
    const planActions = runPlan(world);
    if (planActions && planActions.length > 0) {
      actionCollection = actionCollection.concat(planActions);
    }

    // Collect worker and supply management actions
    actionCollection = actionCollection.concat(
      balanceWorkerDistribution(world, units, world.resources),
      buildSupply(world)
    );

    // Manage Zerg race specific actions
    if (agent.race === Race.ZERG) {
      actionCollection = actionCollection.concat(manageZergSupply(world));
    }

    // Additional worker training
    if (shouldTrainMoreWorkers(totalWorkers, maxWorkers)) {
      actionCollection = actionCollection.concat(trainAdditionalWorkers(world, agent, units.getBases()));
    }

    // Reassign idle workers
    actionCollection = actionCollection.concat(reassignIdleWorkers(world));

    // Send collected actions in a batch
    try {
      if (actionCollection.length > 0) {
        await actions.sendAction(actionCollection);
      }
    } catch (error) {
      console.error('Error sending actions in onStep:', error);
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