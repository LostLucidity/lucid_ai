//@ts-check
"use strict"

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
// Internal module imports
const { UnitType, Ability } = require('@node-sc2/core/constants');

const onGameStart = require('./events/onGameStart');
const { GameState } = require('./gameState');
const config = require('../../config/config');
const { buildSupply } = require('../features/construction/buildingService');
const StrategyManager = require('../features/strategy/strategyManager');
const { clearAllPendingOrders } = require('../gameLogic/unit/unitUtils');
const logger = require('../utils/core/logger');
const economyManagement = require('../utils/economy/economyManagement');
const workerAssignment = require('../utils/economy/workerAssignment');
const unitManagement = require('../utils/unit/unitManagement');

// Instantiate the game state manager
const gameState = GameState.getInstance();

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
  actions.push(...workerAssignment.balanceWorkerDistribution(world, units, world.resources));

  // Ensure sufficient supply to support unit production
  actions.push(...buildSupply(world));

  // Train additional workers to maximize resource collection, if under the maximum worker limit
  if (economyManagement.shouldTrainMoreWorkers(units.getWorkers().length, maxWorkers)) {
    actions.push(...economyManagement.trainAdditionalWorkers(world, world.agent, units.getBases()));
  }

  return actions;
}

/**
 * Handles strategic actions based on the bot's current plan.
 * @param {World} world - The current game world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - A collection of strategic actions.
 */
function handleStrategicActions(world) {
  const strategyManager = StrategyManager.getInstance();

  // Check if there is an active strategic plan.
  if (strategyManager.isActivePlan()) {
    // If there is an active plan, execute it and return the resulting actions.
    return strategyManager.runPlan(world);
  } else {
    // If there is no active plan, return an empty array indicating no actions.
    return [];
  }
}

/**
 * Collects actions to lower SUPPLYDEPOTS that may be blocking paths.
 * @param {World} world - The current game world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of actions to lower SUPPLYDEPOTS.
 */
function collectLowerDepotActions(world) {
  const { units } = world.resources.get();
  const depots = units.getByType(UnitType.SUPPLYDEPOT).filter(depot => depot.buildProgress !== undefined && depot.buildProgress >= 1);

  return depots.reduce((actions, depot) => {
    actions.push(...prepareLowerSupplyDepotAction(world, depot));
    return actions;
  }, /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */([]));
}

/**
 * Prepares an action to lower a SUPPLYDEPOT if it blocks the worker's path.
 * @param {World} world - The current game world state.
 * @param {Unit} depot - The SUPPLYDEPOT unit that needs to be lowered.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of actions to lower the SUPPLYDEPOT.
 */
function prepareLowerSupplyDepotAction(world, depot) {
  // Check if the depot is already lowered
  // We use available abilities to determine if it can be lowered.
  const depotAbilities = depot.availableAbilities();
  const canLower = depotAbilities.includes(Ability.MORPH_SUPPLYDEPOT_LOWER);

  if (!canLower || !depot.tag) {
    return []; // Return empty array as no action is needed, or tag is undefined.
  }

  // Prepare the lower command action
  const lowerDepotCommand = {
    abilityId: Ability.MORPH_SUPPLYDEPOT_LOWER,
    unitTags: [depot.tag], // Now guaranteed to be defined
  };

  // Return the action in an array for later execution
  return [lowerDepotCommand];
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
    gameState.updateGameState(world);
    unitManagement.refreshProductionUnitsCache();

    const { units } = world.resources.get();
    updateMaxWorkers(units);

    let actionCollection = [];

    // Gather strategic actions
    actionCollection.push(...handleStrategicActions(world));

    // Collect actions to lower any SUPPLYDEPOTS if needed
    actionCollection.push(...collectLowerDepotActions(world));

    // Reassign idle workers only if needed, avoiding redundant actions
    if (units.getIdleWorkers().length > 0) {
      actionCollection.push(...workerAssignment.reassignIdleWorkers(world));
    }

    // Add additional actions only if there is no active strategic plan
    if (!StrategyManager.getInstance().isActivePlan()) {
      actionCollection.push(...collectAdditionalActions(world));
    }

    // Execute actions if there are any
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
