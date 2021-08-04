//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const enemyTrackingService = require("./enemy-tracking/enemy-tracking-service");

module.exports = createSystem({
  name: 'TrackEnemySystem',
  type: 'agent',
  async onStep({resources}) {
    const { units } = resources.get();
    enemyTrackingService.clearOutdatedMappedUnits(resources);
    enemyTrackingService.addUnmappedUnit(units);
  },
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    enemyTrackingService.addEnemyUnit(seenEnemyUnit);
  },
  async onUnitDestroyed({}, unitDestroyed) {
    if (unitDestroyed.alliance === Alliance.ENEMY) enemyTrackingService.removeEnemyUnit(unitDestroyed);
  }
});