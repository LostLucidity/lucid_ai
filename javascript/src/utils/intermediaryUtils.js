let sharedData = {
  cumulativeTargetCounts: new Map(),
};

/**
 * Calculate the target count for the current step.
 * @param {import('./globalTypes').BuildOrderStep} step 
 * @param {import('./globalTypes').BuildOrder} buildOrder - The current strategy's build order
 * @param {Map<import('./globalTypes').BuildOrderStep, number>} cumulativeTargetCounts - Shared data for cumulative counts
 * @returns {number}
 */
function calculateTargetCountForStep(step, buildOrder, cumulativeTargetCounts) {
  // Check if we have already calculated the cumulative count for this step
  if (cumulativeTargetCounts.has(step)) {
    return cumulativeTargetCounts.get(step) ?? 0; // Use nullish coalescing to ensure a number is returned
  }

  let cumulativeCount = 0;
  const targetUnitType = step.interpretedAction?.unitType;

  for (let i = 0; i < buildOrder.steps.length; i++) {
    const currentStep = buildOrder.steps[i];
    if (currentStep === step) {
      break;
    }

    // Ensure interpretedAction is defined before accessing its properties
    const interpretedAction = currentStep.interpretedAction;
    if (!interpretedAction) continue; // Skip to the next iteration if interpretedAction is undefined

    if (interpretedAction.isUpgrade === false &&
      interpretedAction.unitType === targetUnitType) {
      cumulativeCount += interpretedAction.count;
    }
  }

  // Add the count for the current step
  const totalCumulativeCount = cumulativeCount + (step.interpretedAction && step.interpretedAction.unitType === targetUnitType ? step.interpretedAction.count : 0);
  cumulativeTargetCounts.set(step, totalCumulativeCount);

  return totalCumulativeCount;
}


// Export the shared data and functions
module.exports = {
  sharedData,
  calculateTargetCountForStep,
};
