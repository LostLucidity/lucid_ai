// src/utils/gameLogic/constants.js

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");

// eslint-disable-next-line no-unused-vars
const GameState = require("../../core/gameState");

/** @type {(unit: Unit, gameState: GameState) => number} */
const zealotModifier = (unit, gameState) => (
  unit.alliance === Alliance.ENEMY && gameState.enemyCharge
) ? 0.5 : 0;

/** @type {(unit: Unit, gameState: GameState) => number} */
const zerglingModifier = (unit, gameState) => {
  const enemyMetabolicBoost = gameState.getEnemyMetabolicBoostState(); // Assuming this method exists in GameState
  return (unit.alliance === Alliance.ENEMY && enemyMetabolicBoost) ? (4.69921875 / 2.9351) - 1 : 0;
};

/** @type Map<UnitTypeId, (unit: Unit, gameState: GameState) => number> */
const SPEED_MODIFIERS = new Map([
  [UnitType.ZEALOT, (/** @type {Unit} */ unit, /** @type {GameState} */ gameState) => zealotModifier(unit, gameState)],
  [UnitType.ZERGLING, zerglingModifier],
]);

module.exports = { SPEED_MODIFIERS };
