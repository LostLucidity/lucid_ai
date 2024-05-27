//@ts-check
"use strict";

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { performance } = require('perf_hooks');

const cacheManager = require('./utils/cache');
const logger = require('./utils/logger');
const config = require('../../config/config');
const ActionCollector = require('../features/actions/actionCollector');
const { resetNoFreeGeysersLogFlag, resetNoValidPositionLogFlag, lastLoggedUnitType } = require('../features/construction/buildingPlacementUtils');
const StrategyManager = require('../features/strategy/strategyManager');
const { clearAllPendingOrders } = require('../gameLogic/gameMechanics/unitUtils');
const { findPlacements } = require('../gameLogic/spatialUtils');
const { GameState } = require('../gameState');
const GameInitialization = require('../initialization/GameInitialization');

const buildOrderCompletion = new Map();
const completedBasesMap = new Map();

const gameState = GameState.getInstance();

let cumulativeGameTime = 0;
let gameStartTime = performance.now();
let lastCheckTime = gameStartTime;
const realTimeCheckInterval = 60 * 1000;

let previousFreeGeysersCount = 0;
let previousValidPositionsCount = 0;

/**
 * Checks and updates the build order progress.
 * @param {World} world - The current game world state.
 * @param {import('./utils/globalTypes').BuildOrderStep[]} buildOrder - The build order to track and update.
 */
async function checkBuildOrderProgress(world, buildOrder) {
  const currentTime = world.resources.get().frame.getGameLoop();
  const BUFFER_TIME_SECONDS = 15;
  const BUFFER_TIME_TICKS = BUFFER_TIME_SECONDS * 22.4;

  buildOrder.forEach(order => {
    let orderStatus = buildOrderCompletion.get(order);

    if (!orderStatus) {
      orderStatus = { completed: false, logged: false };
      buildOrderCompletion.set(order, orderStatus);
    }

    if (!orderStatus.completed) {
      const satisfied = StrategyManager.getInstance().isStepSatisfied(world, order);
      if (satisfied) {
        orderStatus.completed = true;
        console.log(`Build Order Step Completed: Supply-${order.supply} Time-${order.time} Action-${order.action}`);
      } else {
        const expectedTimeInTicks = timeStringToGameTicks(order.time);
        if (expectedTimeInTicks + BUFFER_TIME_TICKS < currentTime && !orderStatus.logged) {
          console.warn(`Build Order Step NOT Completed: Supply-${order.supply} Time-${order.time} Action-${order.action}. Expected by time ${order.time}, current time is ${(currentTime / 22.4).toFixed(2)} seconds.`);
          orderStatus.logged = true;
        }
      }
    }
  });
}

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

/**
 * Get the count of valid positions for building placements.
 * @param {World} world - The current game world state.
 * @param {UnitTypeId} unitType - The type of the unit to place.
 * @returns {number} - The count of valid positions.
 */
function getValidPositionsCount(world, unitType) {
  const candidatePositions = findPlacements(world, unitType);
  return candidatePositions.length;
}

/**
 * Converts a time string in "minutes:seconds" format to game ticks.
 * @param {string} time - The time string to convert.
 * @returns {number} - The equivalent game ticks.
 */
function timeStringToGameTicks(time) {
  const [minutes, seconds] = time.split(':').map(Number);
  return (minutes * 60 + seconds) * 22.4;
}

const bot = createAgent({
  interface: {
    raw: true, rawCropToPlayableArea: true, score: true, showBurrowedShadows: true, showCloaked: true,
  },

  onGameStart: async (world) => {
    try {
      const gameInit = new GameInitialization(world);
      await gameInit.enhancedOnGameStart();

      const now = performance.now();
      gameStartTime = now;
      lastCheckTime = now;
      const { frame, units, map } = world.resources.get();
      gameState.lastGameLoop = frame.getGameLoop();

      const completedBases = units.getBases().filter(base => base.buildProgress !== undefined && base.buildProgress >= 1);
      cacheManager.updateCompletedBasesCache(completedBases);

      previousFreeGeysersCount = map.freeGasGeysers().length;

      if (lastLoggedUnitType) {
        previousValidPositionsCount = getValidPositionsCount(world, lastLoggedUnitType);
      }
    } catch (error) {
      console.error('Error during onGameStart:', error);
    }
  },

  /**
   * Main game loop function called on each step of the game.
   * @param {World} world - The current game world state.
   */
  onStep: async (world) => {
    try {
      const { frame, units, map } = world.resources.get();

      const completedBases = units.getBases().filter(base => {
        if ((base.buildProgress ?? 0) >= 1 && !completedBasesMap.has(base.tag)) {
          completedBasesMap.set(base.tag, true);
          return true;
        }
        return false;
      });

      if (completedBases.length > 0) {
        cacheManager.updateCompletedBasesCache(completedBases);
      }

      const buildOrder = gameState.getBuildOrder();
      await checkBuildOrderProgress(world, buildOrder);

      const actionCollector = new ActionCollector(world);
      const actions = actionCollector.collectActions();
      await executeActions(world, actions);

      const stepEnd = performance.now();
      const realTimeElapsed = (stepEnd - gameStartTime) / 1000;
      const gameTimeElapsed = (frame.getGameLoop() - gameState.lastGameLoop) / 22.4;
      gameState.lastGameLoop = frame.getGameLoop();
      cumulativeGameTime += gameTimeElapsed;

      if (stepEnd - lastCheckTime >= realTimeCheckInterval) {
        if (realTimeElapsed > cumulativeGameTime) {
          console.warn(`Bot is slower than real-time! Cumulative real-time elapsed: ${realTimeElapsed.toFixed(2)}s, Cumulative game-time elapsed: ${cumulativeGameTime.toFixed(2)}s`);
        }
        lastCheckTime = stepEnd;
      }

      const currentFreeGeysersCount = map.freeGasGeysers().length;
      if (currentFreeGeysersCount > previousFreeGeysersCount) {
        resetNoFreeGeysersLogFlag();
      }
      previousFreeGeysersCount = currentFreeGeysersCount;

      if (lastLoggedUnitType) {
        const currentValidPositionsCount = getValidPositionsCount(world, lastLoggedUnitType);
        if (currentValidPositionsCount > previousValidPositionsCount) {
          resetNoValidPositionLogFlag();
        }
        previousValidPositionsCount = currentValidPositionsCount;
      }
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

const engine = createEngine();

engine.connect().then(() => {
  return engine.runGame(config.defaultMap, [
    createPlayer({ race: config.defaultRace }, bot),
    createPlayer({ race: config.defaultRace, difficulty: config.defaultDifficulty }),
  ]);
}).catch(err => {
  logger.logError('Error in connecting to the engine or starting the game:', err);
});

module.exports = bot;
