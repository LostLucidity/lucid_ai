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
const onGameStart = require('../events/onGameStart');
const economyManagement = require('../utils/common/economyManagement');
const unitManagement = require('../utils/common/unitManagement');
const workerAssignment = require('../utils/common/workerAssignment');
const { clearAllPendingOrders } = require('../utils/gameLogic/unitOrderUtils');

// Instantiate the game state manager
const gameState = new GameState();

/** @type {number} Maximum number of workers */
let maxWorkers = 0;

/**
 * Collects additional actions necessary for maintaining the economy and infrastructure.
 * @param {World} world - The current game world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - A collection of additional actions.
 */
function collectAdditionalActions(world) {
  const { units } = world.resources.get();
  const actions = [];

  // Balance worker distribution across bases for optimal resource gathering
  const workerDistributionActions = workerAssignment.balanceWorkerDistribution(world, units, world.resources);
  actions.push(...workerDistributionActions);

  // Ensure sufficient supply to support unit production
  const supplyBuildingActions = buildingService.buildSupply(world);
  actions.push(...supplyBuildingActions);

  // Train additional workers to maximize resource collection, if under the maximum worker limit
  if (economyManagement.shouldTrainMoreWorkers(units.getWorkers().length, maxWorkers)) {
    const workerTrainingActions = economyManagement.trainAdditionalWorkers(world, world.agent, units.getBases());
    actions.push(...workerTrainingActions);
  }

  // Reassign any idle workers to ensure continuous resource collection
  const idleWorkerReassignmentActions = workerAssignment.reassignIdleWorkers(world);
  actions.push(...idleWorkerReassignmentActions);

  return actions;
}

/**
 * Handles strategic actions based on the bot's current plan.
 * @param {World} world - The current game world state.
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} - A collection of strategic actions.
 */
async function handleStrategicActions(world) {
  const strategyService = StrategyService.getInstance();

  // Check if there is an active strategic plan.
  if (strategyService.isActivePlan()) {
    // If there is an active plan, execute it and return the resulting actions.
    return strategyService.runPlan(world);
  } else {
    // If there is no active plan, return an empty array indicating no actions.
    return [];
  }
}


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
    unitManagement.refreshProductionUnitsCache();
    const { units } = world.resources.get();
    updateMaxWorkers(units);

    let actionCollection = await handleStrategicActions(world);

    // Collect additional actions if the strategic plan is not fully occupying the bot's capacity
    if (!StrategyService.getInstance().isActivePlan()) {
      const additionalActions = collectAdditionalActions(world);
      actionCollection = [...actionCollection, ...additionalActions];
    }

    // Execute collected actions
    if (actionCollection.length > 0) {
      try {
        await world.resources.get().actions.sendAction(actionCollection);
        clearAllPendingOrders(units.getAll());
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
