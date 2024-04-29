let sharedData = {
  cumulativeTargetCounts: new Map(),
};

/**
 * @param {GeneralStep} step
 * @param {number} count
 */
function setCumulativeTargetCount(step, count) {
  sharedData.cumulativeTargetCounts.set(step, count);
}

/**
 * @param {GeneralStep} step
 */
function getCumulativeTargetCount(step) {
  return sharedData.cumulativeTargetCounts.get(step) || 0;
}

/**
 * A type that includes both BuildOrderStep and StrategyStep.
 * @typedef {import('../utils/core/globalTypes').BuildOrderStep | import('../features/strategy/strategyManager').StrategyStep} GeneralStep
 */

/**
 * Calculate the target count for a specific step in the build order.
 * @param {GeneralStep} step - The step to calculate the target count for.
 * @param {import('../utils/core/globalTypes').BuildOrder} buildOrder - The build order containing the steps.
 * @param {number} [startingUnitCount=0] - The starting count of units for the unit type in question.
 * @returns {number} - The cumulative target count for the specified step.
 */
function calculateTargetCountForStep(step, buildOrder, startingUnitCount = 0) {
  if (sharedData.cumulativeTargetCounts.has(step)) {
    return getCumulativeTargetCount(step);
  }

  const stepIndex = buildOrder.steps.findIndex(s => getInterpretedActions(s) === getInterpretedActions(step));
  let cumulativeCount = 0;

  for (let i = 0; i < stepIndex; i++) {
    const actions = getInterpretedActions(buildOrder.steps[i]);
    for (const action of actions) {
      if (!action.isUpgrade && getInterpretedActions(step).some(a => a.unitType === action.unitType) && !action.specialAction) {
        cumulativeCount += action.count;
      }
    }
  }

  const stepCount = getInterpretedActions(step).reduce((acc, action) => {
    return (!action.isUpgrade && !action.specialAction) ? acc + action.count : acc;
  }, 0);

  const totalCumulativeCount = cumulativeCount + stepCount + startingUnitCount;

  setCumulativeTargetCount(step, totalCumulativeCount);
  return totalCumulativeCount;
}

/**
 * Get interpreted actions from a step, ensuring the output is always an array.
 * @param {GeneralStep} step - The step from which to get interpreted actions.
 * @returns {import('../utils/core/globalTypes').InterpretedAction[]} - The interpreted actions.
 */
function getInterpretedActions(step) {
  return Array.isArray(step.interpretedAction) ? step.interpretedAction : step.interpretedAction ? [step.interpretedAction] : [];
}

// Export the shared data and functions
module.exports = {
  sharedData,
  calculateTargetCountForStep,
};
