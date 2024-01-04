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
 * @property {string} supply
 * @property {string} time
 * @property {string} action
 * @property {InterpretedAction} [interpretedAction] - Optional property for interpreted action details
 * @property {string} [comment] - Optional comment for the step.
 */

/**
 * @typedef {Object} GameState
 * @property {import("../strategyService").PlanStep[]} plan - The current plan.
 * @property {number} resources - The current resources available to the bot.
 * @property {Object} enemyInfo - Information about the enemy's units and buildings.
 * @property {Object[]} ownUnits - Array of the bot's own units.
 */

/**
 * @typedef {Object} InterpretedAction
 * @property {number|null} unitType - The unit type for the action, if applicable.
 * @property {number|null} upgradeType - The upgrade type for the action, if applicable.
 * @property {number} count - The count for the unit or upgrade.
 * @property {boolean} isUpgrade - Indicates if the action is an upgrade.
 * @property {boolean} isChronoBoosted - Indicates if the action is Chrono Boosted.
 */

/**
 * @typedef {{ [key: string]: BuildOrder | undefined }} RaceBuildOrders
 */

// Dummy exports for JSDoc typedef
module.exports = {
  BuildOrderStep: null,
  BuildOrder: null,
  GameState: null, // Dummy export for JSDoc typedef
  InterpretedAction: null,
  RaceBuildOrders: null,
  BuildOrders: null,
};