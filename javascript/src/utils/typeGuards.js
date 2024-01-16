/**
 * Determines if the given step is a BuildOrderStep.
 * @param {import('./globalTypes').BuildOrderStep | import('../buildOrders/strategy/strategyManager').StrategyStep} step
 * @returns {step is import('./globalTypes').BuildOrderStep}
 */
function isBuildOrderStep(step) {
  return 'uniquePropertyOfBuildOrderStep' in step; // Replace with an actual unique property
}

module.exports = {
  isBuildOrderStep,
};
