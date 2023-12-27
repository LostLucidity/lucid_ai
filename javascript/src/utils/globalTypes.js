/**
 * @typedef {Object} BuildOrder
 * @property {string} title - The title of the build order.
 * @property {string} raceMatchup - The race matchup indicator (e.g., PvZ, TvT, ZvX).
 * @property {BuildOrderStep[]} steps - The steps in the build order.
 * @property {string} url - The URL of the detailed build order page.
 */

/**
 * @typedef {Object} BuildOrders
 * Represents a collection of build orders for each race.
 * @property {RaceBuildOrders} protoss - Build orders for Protoss.
 * @property {RaceBuildOrders} terran - Build orders for Terran.
 * @property {RaceBuildOrders} zerg - Build orders for Zerg.
 * @property {Object.<string, RaceBuildOrders>} [others] - Index signature for dynamic keys.
 */

/**
 * @typedef {Object} BuildOrderStep
 * @property {string} supply - The supply count at this step.
 * @property {string} time - The game time for this step.
 * @property {string} action - The action to be taken at this step.
 */

/**
 * @typedef {Object} GameState
 * @property {number} resources - The current resources available to the bot.
 * @property {Object} enemyInfo - Information about the enemy's units and buildings.
 * @property {Object[]} ownUnits - Array of the bot's own units.
 * // Add more properties as needed to represent your game state
 */

/**
 * @typedef {{ [key: string]: BuildOrder | undefined }} RaceBuildOrders
 */

// Dummy exports for JSDoc typedef
module.exports = {
  BuildOrderStep: null,
  BuildOrder: null,
  GameState: null, // Dummy export for JSDoc typedef
  RaceBuildOrders: null,
  BuildOrders: null,
};