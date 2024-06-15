const { initializeGameState } = require('./gameStateInitialization');
const { initializeStrategyAndAssignWorkers } = require('../features/strategy/utils/strategyInitialization');
const { performInitialMapAnalysis } = require('../gameLogic/shared/mapAnalysis');
const { determineBotRace } = require('../gameLogic/shared/stateManagement');
const GasMineManager = require("../gameState/gasMineManager");
const logger = require('../utils/logger');

/**
 * Class responsible for handling game initialization processes.
 */
class GameInitialization {
  /**
   * Creates an instance of the GameInitialization class.
   * @param {World} world - The current game world state.
   */
  constructor(world) {
    this.world = world;
    this.gasMineManager = new GasMineManager();
  }

  /**
   * Starts and manages game initialization processes.
   */
  async enhancedOnGameStart() {
    try {
      await GameInitialization.onGameStart(this.world);
      this.gasMineManager.initialize(this.world);
    } catch (error) {
      // Ensure that error is an instance of Error before handling
      if (error instanceof Error) {
        logger.logError('Failed to initialize game components:', error);
      } else {
        // If it's not an Error, log a generic error message
        logger.logError('Failed to initialize game components: An unknown error occurred');
      }
      this.handleInitializationFailure(error);
    }
  }

  /**
   * Handles failures during the game initialization process.
   * @param {Error | unknown} error - The error that occurred during initialization.
   */
  handleInitializationFailure(error) {
    const errorInstance = error instanceof Error ? error : new Error('An unknown error occurred during initialization');
    logger.logError('Attempting to recover from initialization error:', errorInstance);
    setTimeout(() => this.retryInitialization(), 1000);
  }

  /**
   * Initialization logic specific to your application.
   * @param {World} world - The current game world state.
   */
  static async onGameStart(world) {
    logger.logMessage('Game Started', 1);

    try {
      const botRace = determineBotRace(world);
      initializeGameState(world, botRace);
      const workerActions = initializeStrategyAndAssignWorkers(world, botRace);
      await world.resources.get().actions.sendAction(workerActions);
      performInitialMapAnalysis(world, botRace);
      // Execute any other necessary actions based on the results from performInitialMapAnalysis
    } catch (error) {
      logger.logError('Error during game start initialization:', error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Retries the initialization process for critical components.
   */
  async retryInitialization() {
    try {
      this.gasMineManager.initialize(this.world);
      logger.logMessage('GasMineManager re-initialized successfully.', 1);
    } catch (error) {
      if (error instanceof Error) {
        logger.logError('Retrying initialization of GasMineManager failed:', error);
      } else {
        logger.logError('Retrying initialization of GasMineManager failed: An unknown error occurred');
      }
    }
  }
}

module.exports = GameInitialization;
