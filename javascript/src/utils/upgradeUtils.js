"use strict";

const { GameState } = require("../state");


/**
 * Check if the upgrade is in progress or completed.
 * @param {Agent} agent
 * @param {string | number} upgradeType
 * @returns {boolean}
 */
function checkUpgradeStatus(agent, upgradeType) {
  const gameState = GameState.getInstance();
  const upgradesInProgress = /** @type {Object<string, boolean>} */ (
    gameState.upgradesInProgress || {}
  );
  const upgradeInProgress = !!upgradesInProgress[upgradeType];
  const upgradeCompleted =
    agent.upgradeIds?.includes(Number(upgradeType)) ?? false;

  return upgradeCompleted || upgradeInProgress;
}

module.exports = {
  checkUpgradeStatus,
};
