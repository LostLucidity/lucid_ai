// src/utils/gameStrategyUtils.js

const { getSingletonInstance } = require("./singletonFactory");
const StrategyManager = require("../buildOrders/strategy/strategyManager");

/**
 * @typedef {Object} GameState
 * @property {import("../buildOrders/strategy/strategyService").PlanStep[]} plan - An array representing the game plan
 */

const gameStrategyUtils = {
  /**
   * Gets the food value of the current step in the plan.
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
};

module.exports = gameStrategyUtils;
