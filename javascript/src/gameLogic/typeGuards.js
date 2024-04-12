/**
 * Determines if the given step is a BuildOrderStep.
 * @param {import('../utils/core/globalTypes').BuildOrderStep | import('../features/strategy/strategyManager').StrategyStep} step
 * @returns {step is import('../utils/core/globalTypes').BuildOrderStep}
 */
function isBuildOrderStep(step) {
  return 'uniquePropertyOfBuildOrderStep' in step; // Replace with an actual unique property
}

module.exports = {
  isBuildOrderStep,
};
