// src/core/events/onGameStart.js

const { initializeStrategyAndAssignWorkers } = require('../../features/strategy/strategyInitialization');
const stateManagement = require('../../gameLogic/resources/stateManagement');
const logger = require('../../utils/core/logger');
const { performInitialMapAnalysis } = require('../../utils/spatial/mapAnalysis');
const { initializeGameState } = require('../initialization/gameStateInitialization');

/**
 * Handles the initial actions to be taken when the game starts.
 * Initializes game state, strategy, and performs initial map analysis.
 * 
 * @param {World} world - The game world context.
 */
async function onGameStart(world) {
  logger.logMessage('Game Started', 1);

  try {
    const botRace = stateManagement.determineBotRace(world);
    initializeGameState(world, botRace);
    const workerActions = initializeStrategyAndAssignWorkers(world, botRace);
    await world.resources.get().actions.sendAction(workerActions);
    performInitialMapAnalysis(world, botRace);
    // Execute any other necessary actions based on the results from performInitialMapAnalysis
  } catch (error) {
    logger.logError('Error during game start initialization:', error instanceof Error ? error : new Error('Unknown error'));
  }
}

module.exports = onGameStart;