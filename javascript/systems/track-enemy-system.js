//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const enemyTrackingService = require("../services/enemy-tracking-service");

module.exports = createSystem({
  name: 'TrackEnemySystem',
  type: 'agent',
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    enemyTrackingService.addEnemyUnit(seenEnemyUnit);
  },
  async onUnitDestroyed({}, unitDestroyed) {
    enemyTrackingService.removeEnemyUnit(unitDestroyed);
  }
})