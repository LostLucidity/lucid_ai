// src/utils/strategyUtils.js

const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");

/**
 * Converts strategy steps (from BuildOrderStep or StrategyStep format) to PlanStep format.
 * @param {(import("../../utils/globalTypes").BuildOrderStep[] | import("./strategyManager").StrategyStep[])} strategySteps - Array of strategy steps, either BuildOrderStep or StrategyStep.
 * @returns {import("./strategyService").PlanStep[]} Array of PlanStep objects.
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
 * Calculates the maximum supply from an array of build order steps, focusing on the last supply unit.
 * @param {import('../../utils/globalTypes').BuildOrderStep[]} steps - The steps in the build order.
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

module.exports = {
  convertToPlanSteps,
  getMaxSupplyFromPlan
};