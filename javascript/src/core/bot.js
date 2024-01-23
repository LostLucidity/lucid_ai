//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Race } = require('@node-sc2/core/constants/enums');

// Internal module imports
const GameState = require('./gameState');
const { logMessage, logError } = require('./logger');
const config = require('../../config/config');
const StrategyManager = require('../buildOrders/strategy/strategyManager');
const StrategyService = require('../buildOrders/strategy/strategyService');
const { convertToPlanSteps, getMaxSupplyFromPlan } = require('../buildOrders/strategy/strategyUtils');
const BuildingPlacement = require('../construction/buildingPlacement');
const { buildSupply } = require('../construction/buildingService');
const { shouldTrainMoreWorkers, trainAdditionalWorkers, calculateMaxWorkers } = require('../economyManagement');
const { calculateAdjacentToRampGrids } = require('../mapUtils');
const { refreshProductionUnitsCache, manageZergSupply } = require('../unitManagement');
const { determineBotRace } = require('../utils/gameStateHelpers');
const { assignWorkers } = require('../utils/sharedWorkerUtils');
const { balanceWorkerDistribution, reassignIdleWorkers } = require('../workerAssignment');

// Instantiate the game state manager
const gameState = new GameState();

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
  const workerActions = assignWorkers(resourceManager); // Pass the ResourceManager object
  actionCollection.push(...workerActions);

  // Return the collection of actions
  return actionCollection;
}

/**
 * Performs initial map analysis based on the bot's race.
 * @param {World} world - The game world context.
 */
function performInitialMapAnalysis(world) {
  const botRace = determineBotRace(world);
  const map = world.resources.get().map;
  StrategyManager.getInstance(botRace);
  if (botRace === Race.TERRAN) {
    // First calculate the grids adjacent to ramps
    calculateAdjacentToRampGrids(map);

    // Then calculate wall-off positions using the calculated ramp grids
    BuildingPlacement.calculateWallOffPositions(world);
  }
}

// Create a new StarCraft II bot agent with event handlers.
const bot = createAgent({
  interface: {
      raw: true,
      rawCropToPlayableArea: true,
      score: true,
      showBurrowedShadows: true,
      showCloaked: true
  },
  async onGameStart(world) {
    logMessage('Game Started', 1);

    const botRace = determineBotRace(world);
    const gameState = GameState.getInstance();
    gameState.setRace(botRace);

    const strategyManager = StrategyManager.getInstance(botRace);
    if (!strategyManager.getCurrentStrategy()) {
      strategyManager.initializeStrategy(botRace);
    }

    try {
      const buildOrder = strategyManager.getBuildOrderForCurrentStrategy(world);
      const maxSupply = getMaxSupplyFromPlan(buildOrder.steps, botRace);
      config.planMax = { supply: maxSupply, gasMine: 0 }; // Assuming 0 is a sensible default for gasMine

      const currentStrategy = strategyManager.getCurrentStrategy();
      if (currentStrategy?.steps) {
        gameState.setPlan(convertToPlanSteps(currentStrategy.steps));
      }
    } catch (error) {
      logError('Error during strategy setup:', error instanceof Error ? error : new Error('Unknown error'));
    }

    performInitialMapAnalysis(world);
    gameState.initializeStartingUnitCounts(botRace);
    gameState.verifyStartingUnitCounts(world);

    try {
      const actionCollection = assignInitialWorkers(world);
      const { actions } = world.resources.get();
      await actions.sendAction(actionCollection);
    } catch (error) {
      logError('Error during initial worker assignment:', error instanceof Error ? error : new Error('Unknown error'));
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
    const strategyService = StrategyService.getInstance();
    const planActions = strategyService.runPlan(world);
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