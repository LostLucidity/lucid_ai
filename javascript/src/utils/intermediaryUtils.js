let sharedData = {
  cumulativeTargetCounts: new Map(),
};

/**
 * A type that includes both BuildOrderStep and StrategyStep.
 * @typedef {import('./globalTypes').BuildOrderStep | import('../strategyManager').StrategyStep} GeneralStep
 */

/**
 * Calculate the target count for a specific step in the build order.
 * @param {GeneralStep} step - The step to calculate the target count for.
 * @param {import('./globalTypes').BuildOrder} buildOrder - The build order containing the steps.
 * @param {Map<GeneralStep, number>} cumulativeTargetCounts - A map to store cumulative target counts.
 * @param {number} startingUnitCount - The starting count of units for the unit type in question.
 * @returns {number} - The cumulative target count for the specified step.
 */
function calculateTargetCountForStep(step, buildOrder, cumulativeTargetCounts, startingUnitCount) {
  if (cumulativeTargetCounts.has(step)) {
    return cumulativeTargetCounts.get(step) || 0;
  }

  let cumulativeCount = 0;

  /**
 * Get interpreted actions from a step.
 * @param {GeneralStep} step - The step from which to get interpreted actions.
 * @returns {import('./globalTypes').InterpretedAction[]} - The interpreted actions.
 */
  const getInterpretedActions = (step) => Array.isArray(step.interpretedAction) ? step.interpretedAction : step.interpretedAction ? [step.interpretedAction] : [];

  const unitTypesInCurrentStep = new Set(getInterpretedActions(step).map(action => action.unitType));

  for (const currentStep of buildOrder.steps) {
    if (currentStep === step) break;

    for (const action of getInterpretedActions(currentStep)) {
      if (!action.isUpgrade && unitTypesInCurrentStep.has(action.unitType)) {
        cumulativeCount += action.count;
      }
    }
  }

  const stepCount = getInterpretedActions(step).reduce((acc, action) => action.isUpgrade ? acc : acc + action.count, 0);
  const totalCumulativeCount = cumulativeCount + stepCount + startingUnitCount;

  cumulativeTargetCounts.set(step, totalCumulativeCount);

  return totalCumulativeCount;
}

// Export the shared data and functions
module.exports = {
  sharedData,
  calculateTargetCountForStep,
};
