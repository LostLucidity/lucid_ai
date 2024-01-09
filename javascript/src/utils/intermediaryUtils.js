let sharedData = {
  cumulativeTargetCounts: new Map(),
};

/**
 * A type that includes both BuildOrderStep and StrategyStep.
 * @typedef {import('./globalTypes').BuildOrderStep | import('../strategyManager').StrategyStep} GeneralStep
 */

/**
 * @param {GeneralStep} step 
 * @param {import('./globalTypes').BuildOrder} buildOrder 
 * @param {Map<GeneralStep, number>} cumulativeTargetCounts 
 * @returns {number}
 */
function calculateTargetCountForStep(step, buildOrder, cumulativeTargetCounts) {
  // Ensure interpretedActions is always an array
  const stepInterpretedActions = Array.isArray(step.interpretedAction) ? step.interpretedAction : step.interpretedAction ? [step.interpretedAction] : [];

  if (cumulativeTargetCounts.has(step)) {
    return cumulativeTargetCounts.get(step) ?? 0;
  }

  let cumulativeCount = 0;

  buildOrder.steps.forEach(currentStep => {
    if (currentStep === step) {
      return;
    }

    const currentStepInterpretedActions = Array.isArray(currentStep.interpretedAction) ? currentStep.interpretedAction : currentStep.interpretedAction ? [currentStep.interpretedAction] : [];

    currentStepInterpretedActions.forEach(interpretedAction => {
      if (interpretedAction.isUpgrade === false) {
        stepInterpretedActions.forEach(action => {
          if (action.unitType === interpretedAction.unitType) {
            cumulativeCount += interpretedAction.count;
          }
        });
      }
    });
  });

  const stepCount = stepInterpretedActions.reduce((acc, action) => {
    if (action.isUpgrade === false) {
      acc += action.count;
    }
    return acc;
  }, 0);

  const totalCumulativeCount = cumulativeCount + stepCount;
  cumulativeTargetCounts.set(step, totalCumulativeCount);

  return totalCumulativeCount;
}

// Export the shared data and functions
module.exports = {
  sharedData,
  calculateTargetCountForStep,
};
