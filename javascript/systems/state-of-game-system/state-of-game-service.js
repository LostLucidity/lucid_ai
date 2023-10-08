//@ts-check
"use strict"

const stateOfGameService = {
  stateOfGame: new Map(),
  /** @type World | null */
  world: null,
  clearStateOfGame() {
    // clear enemyUnits from stateOfGame
    const enemyUnits = this.stateOfGame.get('enemyUnits');
    if (enemyUnits) {
      enemyUnits.clear();
    }
  },
}

module.exports = stateOfGameService;