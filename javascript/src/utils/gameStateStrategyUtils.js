// src/utils/gameStateStrategyUtils.js
const { getSingletonInstance } = require("./singletonFactory");
/* eslint-disable-next-line no-unused-vars */
const GameState = require("../gameState"); // Import the GameState class
const StrategyManager = require("../strategyManager");

const gameStateStrategyUtils = {
  /**
   * Gets the food value of the current step in the strategy plan.
   * @param {GameState} gameState - The GameState instance
   * @returns {number}
   */
  getPlanFoodValue(gameState) {
    const strategyManager = getSingletonInstance(StrategyManager);
    if (gameState.plan.length === 0 || strategyManager.getCurrentStep() >= gameState.plan.length) {
      console.error('Plan is empty or current step is out of range.');
      return 0;
    }
    return gameState.plan[strategyManager.getCurrentStep()].food;
  },

  // Other functions interacting with StrategyManager can be added here
};

module.exports = gameStateStrategyUtils;
