// src/utils/strategyUtils.js

const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");

const StrategyContext = require("../features/strategy/strategyContext");
/* eslint-disable-next-line no-unused-vars */
const { GameState } = require('../state');

/**
 * Converts strategy steps (from BuildOrderStep or StrategyStep format) to PlanStep format.
 * @param {(import("./globalTypes").BuildOrderStep[] | import("../features/strategy/strategyManager").StrategyStep[])} strategySteps - Array of strategy steps, either BuildOrderStep or StrategyStep.
 * @returns {import("../features/strategy/strategyManager").PlanStep[]} Array of PlanStep objects.
 */
function convertToPlanSteps(strategySteps) {
  return strategySteps.map(step => {
    let unitType = 0; // Default value, adjust as necessary
    let upgrade = 0; // Default value, adjust to a sensible default
    let count = 1;   // Default value for count
    let isChronoBoosted = false; // Default value for isChronoBoosted
    let food = 0;    // Default value for food

    // Derive unitType based on the step properties
    if ('unitType' in step && typeof step.unitType === 'number') {
      unitType = step.unitType;
    } else {
      // Derive unitType based on other properties of step
      // unitType = deriveUnitType(step) or use a suitable default
    }

    // Check for upgrade property and ensure it's the correct type
    if ('upgrade' in step && typeof step.upgrade === 'number') {
      upgrade = step.upgrade;
    } // else keep default value (0 or another suitable default)

    // Check for count property and ensure it's the correct type
    if ('count' in step && typeof step.count === 'number') {
      count = step.count;
    } // else keep default value (1 or another suitable default)

    // Check for isChronoBoosted property and ensure it's a boolean
    if ('isChronoBoosted' in step && typeof step.isChronoBoosted === 'boolean') {
      isChronoBoosted = step.isChronoBoosted;
    } // else keep default value (false)

    // Check for food property and ensure it's the correct type
    if ('food' in step && typeof step.food === 'number') {
      food = step.food;
    } // else keep default value (0)

    // Ensure 'supply' is always a number
    let supplyValue = typeof step.supply === 'number' ? step.supply : parseInt(step.supply, 10) || 0;

    // Determine orderType based on the type of step
    let orderType;
    if ('isUpgrade' in step) {
      // This block will execute if step is of a type that has an isUpgrade property
      orderType = step.isUpgrade ? 'Upgrade' : 'UnitType';
    } else {
      // Define logic for steps that do not have the isUpgrade property
      // For example, set a default value or derive it based on other properties
      orderType = 'UnitType'; // or some other default logic
    }

    let targetCount = count; // Assuming count is the same as targetCount
    /**
     * @type {Point2D[]}
     */
    let candidatePositions = []; // Default to empty array

    return {
      unitType: unitType,
      upgrade: upgrade,
      count: count,
      isChronoBoosted: isChronoBoosted,
      food: food,
      supply: supplyValue,
      time: step.time || '00:00',
      action: step.action || 'none',
      orderType: orderType, // Newly added
      targetCount: targetCount, // Newly added
      candidatePositions: candidatePositions // Newly added
    };
  });
}

/**
 * Retrieves the build order key from the current strategy.
 * @returns {string} - The determined build order key.
 */
function getBuildOrderKey() {
const strategyContext = StrategyContext.getInstance();
const currentStrategy = strategyContext.getCurrentStrategy();

if (currentStrategy) {
  if ("title" in currentStrategy) {
    return currentStrategy.title;
  } else if ("name" in currentStrategy) {
    return currentStrategy.name;
  }
}

return "defaultKey";
}

/**
 * Calculates the maximum supply from an array of build order steps, focusing on the last supply unit.
 * @param {import('./globalTypes').BuildOrderStep[]} steps - The steps in the build order.
 * @param {SC2APIProtocol.Race} race - The race of the bot.
 * @returns {number} The maximum supply value.
 */
function getMaxSupplyFromPlan(steps, race) {
  const supplyUnitType = SupplyUnitRace[race];

  let maxSupply = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.interpretedAction) {
      const interpretedActions = Array.isArray(step.interpretedAction) ? step.interpretedAction : [step.interpretedAction];
      if (interpretedActions.some(action => action.unitType === supplyUnitType)) {
        maxSupply = parseInt(step.supply, 10);
        break;
      }
    }
  }

  return maxSupply;
}

/**
 * Gets the food value of the current step in the strategy plan.
 * @param {GameState} gameState - The GameState instance
 * @returns {number}
 */
function getPlanFoodValue(gameState) {
  const strategyContext = StrategyContext.getInstance();
  if (gameState.plan.length === 0 || strategyContext.getCurrentStep() >= gameState.plan.length) {
    console.error('Plan is empty or current step is out of range.');
    return 0;
  }
  return gameState.plan[strategyContext.getCurrentStep()].food;
}

/**
 * Determines if two steps are similar based on their 'action' and potentially 'unitType'.
 * This function accounts for differences in structure between BuildOrderStep and StrategyStep.
 * @param {import("../features/strategy/strategyData").GeneralStep} stepA - First step to compare.
 * @param {import("../features/strategy/strategyData").GeneralStep} stepB - Second step to compare.
 * @returns {boolean} True if the steps are considered similar, false otherwise.
 */
function isEqualStep(stepA, stepB) {
  /**
   * Extracts the unit type from a step, which could be either a BuildOrderStep or a StrategyStep.
   * @param {import("../features/strategy/strategyData").GeneralStep} step - The step from which to extract the unit type.
   * @returns {number | null} - The unit type if available, otherwise null.
   */
  const getUnitType = (step) => {
    if (step && step.interpretedAction) {
      if (Array.isArray(step.interpretedAction)) {
        return step.interpretedAction.length > 0 ? step.interpretedAction[0].unitType : null;
      } else {
        return step.interpretedAction.unitType;
      }
    }
    return null;
  };

  // Additional checks for time and supply to better differentiate steps
  return stepA.action === stepB.action &&
    getUnitType(stepA) === getUnitType(stepB) &&
    stepA.time === stepB.time &&
    stepA.supply === stepB.supply;
}

/**
 * @param {import("./globalTypes").BuildOrder | import("../features/strategy/strategyManager").Strategy | undefined} plan
 */
function isValidPlan(plan) {
  return plan && Array.isArray(plan.steps);
}

/**
 * @param {Agent} agent
 */
function validateResources(agent) {
  const { minerals, vespene } = agent;
  return !(minerals === undefined || vespene === undefined);
}

module.exports = {
  convertToPlanSteps,
  getBuildOrderKey,
  getMaxSupplyFromPlan,
  getPlanFoodValue,
  isEqualStep,
  isValidPlan,
  validateResources
};