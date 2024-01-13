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
    // Add startingUnitCount to the total cumulative count stored in the map
    return (cumulativeTargetCounts.get(step) || 0) + startingUnitCount;
  }

  let cumulativeCount = 0;
  let reachedCurrentStep = false;

  const interpretedActions = Array.isArray(step.interpretedAction) ? step.interpretedAction : step.interpretedAction ? [step.interpretedAction] : [];
  const unitTypesInCurrentStep = new Set(interpretedActions.map(action => action.unitType));

  for (const currentStep of buildOrder.steps) {
    if (currentStep === step) {
      reachedCurrentStep = true;
      break;
    }

    const currentStepActions = Array.isArray(currentStep.interpretedAction) ? currentStep.interpretedAction : currentStep.interpretedAction ? [currentStep.interpretedAction] : [];

    for (const action of currentStepActions) {
      if (!action.isUpgrade && unitTypesInCurrentStep.has(action.unitType)) {
        cumulativeCount += action.count;
      }
    }
  }

  const stepCount = reachedCurrentStep ? interpretedActions.reduce((acc, action) => action.isUpgrade ? acc : acc + action.count, 0) : 0;
  const totalCumulativeCount = cumulativeCount + stepCount;

  // Include startingUnitCount in the total cumulative count
  cumulativeTargetCounts.set(step, totalCumulativeCount + startingUnitCount);

  return totalCumulativeCount + startingUnitCount;
}


// Export the shared data and functions
module.exports = {
  sharedData,
  calculateTargetCountForStep,
};
