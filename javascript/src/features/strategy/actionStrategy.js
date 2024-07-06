// src/features/strategy/actionStrategy.js

/**
 * Represents the base class for action strategies within the game.
 */
class ActionStrategy {
  /**
   * Executes the strategy for a given plan step.
   * @param {World} _world The game world context, not used in the base class but may be used in subclasses.
   * @param {import("./strategyManager").PlanStep} _planStep The plan step to be executed.
   */
  static execute(_world, _planStep) {
    // Method to be implemented by subclasses
  }
}

module.exports = ActionStrategy; // Exporting the class
