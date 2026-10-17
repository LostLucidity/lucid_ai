const { initializeGameState } = require('./gameStateInitialization');
const { setupStrategyAndWorkers } = require('./strategySetup.js.js');
const logger = require('../core/logger');
const GasMineManager = require("../state/gasMineManager");
const { performInitialMapAnalysis } = require('../utils/mapAnalysis');
const { determineBotRace } = require('../utils/stateManagement');

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
      const errorInstance = error instanceof Error ? error : new Error('An unknown error occurred during initialization');
      logger.logError('Failed to initialize game components:', errorInstance);
      throw errorInstance;
    }
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
      const workerActions = await setupStrategyAndWorkers(world, botRace);
      await world.resources.get().actions.sendAction(workerActions);
      performInitialMapAnalysis(world, botRace);
      // Execute any other necessary actions based on the results from performInitialMapAnalysis
    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error('Unknown error');
      logger.logError('Error during game start initialization:', errorInstance);
      throw errorInstance;
    }
  }
}

module.exports = GameInitialization;
