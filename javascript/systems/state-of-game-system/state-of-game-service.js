//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getInRangeUnits } = require("../../helper/battle-analysis");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../track-units/track-units-service");

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
  /**
   * @param {Unit} unit
   * @returns {Unit[]}
   */
  getEnemyUnits(unit) {
    // check if enemy units are in stateOfGame map, if not, add them
    const { stateOfGame } = stateOfGameService;
    if (!stateOfGame.has('enemyUnits')) {
      stateOfGameService.stateOfGame.set('enemyUnits', new Map());
    }
    const enemyUnits = stateOfGame.get('enemyUnits').get(unit.tag);
    if (enemyUnits) {
      return enemyUnits;
    } else {
      // if no enemy units in state of game map, get enemy units from world
      const { world } = stateOfGameService;
      if (world) {
        const { units } = world.resources.get();
        const enemyUnits = units.getAlive(unit.alliance === Alliance.SELF ? Alliance.ENEMY : Alliance.SELF);
        if (unit.alliance === Alliance.ENEMY) {
          const { missingUnits } = trackUnitsService;
          enemyUnits.push(...missingUnits);
        } else {
          const { mappedEnemyUnits } = enemyTrackingService;
          enemyUnits.push(...mappedEnemyUnits);
        }
        stateOfGameService.stateOfGame.set('enemyUnits', new Map([[unit.tag, getInRangeUnits(unit, enemyUnits)]]));
        return enemyUnits;
        } else {
        return [];
      }
    }
  }
}

module.exports = stateOfGameService;