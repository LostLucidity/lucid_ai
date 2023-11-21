//@ts-check
"use strict"

/**
 * Class representing the game state.
 * It maintains and manages various game-related data such as resources, unit statuses, etc.
 */
class GameState {
  /**
   * Constructor for the GameState class.
   */
  constructor() {
    this.reset();
  }

  /**
   * Resets or initializes the game state variables.
   * This method should be called at the end of a game or when initializing.
   */
  reset() {
    this.resources = {}; // Example: { minerals: 0, vespene: 0 }
    this.unitStatuses = {}; // Example: { 'unitId1': 'idle', 'unitId2': 'harvesting' }
    // Additional state variables can be added here
  }
}

module.exports = GameState;
