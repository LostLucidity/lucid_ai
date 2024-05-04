const { isEqualStep } = require('../../features/strategy/strategyUtils');

let sharedData = {
  cumulativeTargetCounts: new Map(),
};

/**
 * Retrieve the cumulative target count for a specific step.
 * @param {string} step - The step identifier to retrieve the count for.
 * @returns {number} - The cumulative target count for the step.
 */
function getCumulativeTargetCount(step) {
  return sharedData.cumulativeTargetCounts.get(step) || 0;
}

/**
 * Sets the cumulative target count for a specific step.
 * @param {string} unitTypeKey - A unique key representing the unit type.
 * @param {number} count - The cumulative count to set.
 */
function setCumulativeTargetCount(unitTypeKey, count) {
  sharedData.cumulativeTargetCounts.set(unitTypeKey, count);
}

/**
 * A type that includes both BuildOrderStep and StrategyStep.
 * @typedef {import('../../core/utils/globalTypes').BuildOrderStep | import('../../features/strategy/strategyManager').StrategyStep} GeneralStep
 */

/**
 * Calculate the cumulative target count for a specific step in the build order, separated by unit type.
 * This function will calculate the cumulative counts up to and including the current step index,
 * ensuring that counts for each unit type are properly isolated per step.
 * @param {GeneralStep} step - The step to calculate the target count for.
 * @param {import('../../core/utils/globalTypes').BuildOrder} buildOrder - The build order containing the steps.
 * @param {Record<string, number>} [startingUnitCounts={}] - An object mapping unit types to their initial counts.
 * @returns {Record<string, number>} - The cumulative target counts for each unit type in the specified step.
 */
function calculateTargetCountForStep(step, buildOrder, startingUnitCounts = {}) {
  const stepIndex = buildOrder.steps.findIndex(s => isEqualStep(s, step));

  let cumulativeCounts = { ...startingUnitCounts };  // Start with the initial unit counts
  buildOrder.steps.forEach((s, index) => {
    getInterpretedActions(s).forEach(action => {
      if (action.unitType !== null && !action.isUpgrade && !action.specialAction) {
        const unitTypeKey = `unitType_${action.unitType}_step_${index}`;
        let lastKey = index > 0 ? getLastStepKeyForUnitType(action.unitType, index - 1) : null;
        let lastCount = lastKey ? getCumulativeTargetCount(lastKey) : (startingUnitCounts[`unitType_${action.unitType}`] || 0);

        cumulativeCounts[unitTypeKey] = lastCount + (action.count || 0);
        setCumulativeTargetCount(unitTypeKey, cumulativeCounts[unitTypeKey]);
      }
    });
  });

  /** @type {Record<string, number>} */
  let finalCumulativeCounts = {};
  Object.keys(cumulativeCounts).forEach(key => {
    if (key.endsWith(`step_${stepIndex}`)) {
      finalCumulativeCounts[key] = cumulativeCounts[key];
    }
  });

  return finalCumulativeCounts;
}

/**
 * Checks if a given key exists in the shared data.
 * @param {string} key - The key to check in the cumulativeCounts object.
 * @returns {boolean} - True if the key exists, otherwise false.
 */
function checkIfKeyExists(key) {
  return sharedData.cumulativeTargetCounts.has(key);
}

/**
 * Get interpreted actions from a step, ensuring the output is always an array.
 * @param {GeneralStep} step - The step from which to get interpreted actions.
 * @returns {import('../../core/utils/globalTypes').InterpretedAction[]} - The interpreted actions.
 */
function getInterpretedActions(step) {
  return Array.isArray(step.interpretedAction) ? step.interpretedAction : step.interpretedAction ? [step.interpretedAction] : [];
}

/**
 * Retrieves the last cumulative count key for a given unit type up to a specified step.
 * This function checks for the presence of a specific cumulative count key and returns it if present.
 * If no key is found up to the specified last step, it returns null, indicating that no previous counts were recorded.
 * @param {number} unitType - The unit type identifier.
 * @param {number} lastStep - The last step to consider for retrieving the cumulative count.
 * @returns {string | null} - The key of the last step with the cumulative count for this unit type, or null if not found.
 */
function getLastStepKeyForUnitType(unitType, lastStep) {
  for (let step = lastStep; step >= 0; step--) {
    let key = `unitType_${unitType}_step_${step}`;
    if (checkIfKeyExists(key)) {
      return key;
    }
  }
  return null;
}

// Export the shared data and functions
module.exports = {
  sharedData,
  calculateTargetCountForStep,
};
