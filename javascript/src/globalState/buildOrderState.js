/**
 * Manages the build order state.
 * @module buildOrderState
 */

let buildOrderCompleted = false;

module.exports = {
  /**
   * Checks if the build order is completed.
   * @returns {boolean} - True if the build order is completed, false otherwise.
   */
  isBuildOrderCompleted: () => buildOrderCompleted,

  /**
   * Sets the build order completed state.
   * @param {boolean} state - The new state of the build order completion.
   */
  setBuildOrderCompleted: (state) => { buildOrderCompleted = state; },
};
