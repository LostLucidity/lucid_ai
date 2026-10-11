// src/utils/gameLogic/constants.js

const { Ability, UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");

// eslint-disable-next-line no-unused-vars
const { GameState } = require('../state');

// Blizzard s2client-proto stableid.json Buffs entries. The installed
// @node-sc2/core version does not export symbolic buff IDs.
const BUFF_IDS = Object.freeze({
  STIMPACK: 27,
  CHRONOBOOSTENERGYCOST: 281,
});

// The installed @node-sc2/core version exports these stable abilities but not
// the rallyWorkersAbilities group expected by the restored worker service.
const RALLY_WORKER_ABILITIES = Object.freeze([
  Ability.RALLY_WORKERS,
  Ability.RALLY_COMMANDCENTER,
  Ability.RALLY_HATCHERY_WORKERS,
  Ability.RALLY_NEXUS,
]);

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

module.exports = { BUFF_IDS, RALLY_WORKER_ABILITIES, SPEED_MODIFIERS };
