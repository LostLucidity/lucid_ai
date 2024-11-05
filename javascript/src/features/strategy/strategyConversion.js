/**
 * @typedef {Object} CombinedStep
 * @property {string} supply - The supply count for the step, standardized as a string for consistent processing.
 * @property {string} time - The game time for the step.
 * @property {string} action - The action to be taken.
 * @property {string | undefined} comment - An optional comment for the step.
 * @property {boolean} completed - Indicates if the step is completed.
 * @property {import("../../core/globalTypes").InterpretedAction[]} interpretedAction - Array of interpreted actions.
 */

/**
 * Converts a BuildOrder to a format compatible with both Strategy and BuildOrder properties.
 * @param {import("../../core/globalTypes").BuildOrder} buildOrder - The build order to convert.
 * @returns {import("../../types/strategyTypes").Strategy & import("../../core/globalTypes").BuildOrder}
 */
function mapBuildOrderToStrategy(buildOrder) {
  /** @type {CombinedStep[]} */
  const strategySteps = buildOrder.steps.map((step) => ({
    supply: String(step.supply),  // Standardize supply as a string for consistency
    time: step.time,
    action: step.action,
    comment: step.comment,
    completed: step.completed ?? false,
    interpretedAction: Array.isArray(step.interpretedAction)
      ? step.interpretedAction
      : step.interpretedAction ? [step.interpretedAction] : [],
  }));

  return {
    name: buildOrder.title,
    race: buildOrder.raceMatchup,
    description: `Build order for ${buildOrder.title} - ${buildOrder.raceMatchup}`,
    steps: strategySteps,

    title: buildOrder.title,
    raceMatchup: buildOrder.raceMatchup,
    url: buildOrder.url,
  };
}

module.exports = { mapBuildOrderToStrategy };
