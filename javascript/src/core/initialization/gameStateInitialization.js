// eslint-disable-next-line no-unused-vars
const { Race } = require('@node-sc2/core/constants/enums');

const { initializeGasMineConstructionAbilities } = require('../../utils/economy/economyManagement');
const { setUnitTypeTrainingAbilityMapping } = require('../../utils/unitManagement/unitConfig');
const { GameState } = require('../gameState');

/**
 * Initializes the game state by setting the race, initializing unit type mappings, and gas mine abilities.
 * @param {World} world - The game world context.
 * @param {Race} botRace - The race of the bot.
 */
function initializeGameState(world, botRace) {
  const gameState = GameState.getInstance();
  gameState.setRace(botRace);

  // Set mappings for unit types and their abilities
  setUnitTypeTrainingAbilityMapping(world.data);

  // Initialize abilities specifically for constructing gas mines
  initializeGasMineConstructionAbilities();

  // Initialize and verify other starting conditions
  initializeStartingUnitCounts(gameState, botRace);
  verifyStartingUnitCounts(gameState, world);
}

/**
 * Initializes the count of starting units based on the bot's race.
 * @param {GameState} gameState - The state manager for the game.
 * @param {Race} botRace - The race of the bot.
 */
function initializeStartingUnitCounts(gameState, botRace) {
  gameState.initializeStartingUnitCounts(botRace);
}

/**
 * Verifies the initial unit counts are as expected.
 * @param {GameState} gameState - The state manager for the game.
 * @param {World} world - The game world context.
 */
function verifyStartingUnitCounts(gameState, world) {
  gameState.verifyStartingUnitCounts(world);
}

module.exports = { initializeGameState };
