// src/utils/strategyUtils.js

const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");

const { interpretBuildOrderAction } = require("../../data/buildOrders/scripts/buildOrderUtils");
const StrategyContext = require("../features/strategy/strategyContext");
/* eslint-disable-next-line no-unused-vars */
const { GameState } = require('../state');

/**
 * Extracts the unit type from a step, which could be either a BuildOrderStep or a StrategyStep.
 * @param {import("../features/strategy/strategyData").GeneralStep} step - The step from which to extract the unit type.
 * @returns {number | null} - The unit type if available, otherwise null.
 */
function getUnitType(step) {
  if (step && step.interpretedAction) {
    if (Array.isArray(step.interpretedAction)) {
      return step.interpretedAction.length > 0 ? step.interpretedAction[0].unitType : null;
    }
    return /** @type {import("../core/globalTypes").InterpretedAction} */ (step.interpretedAction).unitType;
  }
  return null;
}

/**
 * Converts strategy steps (from BuildOrderStep or StrategyStep format) to PlanStep format.
 * @param {(import("../core/globalTypes").BuildOrderStep[] | import("../types/strategyTypes").StrategyStep[])} strategySteps - Array of strategy steps, either BuildOrderStep or StrategyStep.
 * @returns {import("../types/strategyTypes").PlanStep[]} Array of PlanStep objects.
 */
function convertToPlanSteps(strategySteps) {
  return strategySteps.map(step => {
    const comment = 'comment' in step ? step.comment : '';

    const interpretedActions = interpretBuildOrderAction(step.action, comment);

    const firstAction = interpretedActions[0] || {};

    const unitType = firstAction.unitType || 0;
    const upgrade = firstAction.upgradeType || 0;
    const count = firstAction.count || 1;
    const isChronoBoosted = firstAction.isChronoBoosted || false;
    const isUpgrade = firstAction.isUpgrade || false;
    const food = 'food' in step && typeof step.food === 'number' ? step.food : 0;

    const supplyValue = typeof step.supply === 'number' ? step.supply : parseInt(step.supply, 10) || 0;

    const orderType = isUpgrade ? 'Upgrade' : 'UnitType';
    const targetCount = count;
    /** @type {Point2D[]} */
    const candidatePositions = [];

    return {
      unitType,
      upgrade,
      count,
      isChronoBoosted,
      food,
      supply: supplyValue,
      time: step.time || '00:00',
      action: step.action || 'none',
      orderType,
      targetCount,
      candidatePositions
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
 * @param {import('../core/globalTypes').BuildOrderStep[]} steps - The steps in the build order.
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
  // Additional checks for time and supply to better differentiate steps
  return stepA.action === stepB.action &&
    getUnitType(stepA) === getUnitType(stepB) &&
    stepA.time === stepB.time &&
    stepA.supply === stepB.supply;
}

/**
 * @param {import("../core/globalTypes").BuildOrder | import("../types/strategyTypes").Strategy | undefined} plan
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