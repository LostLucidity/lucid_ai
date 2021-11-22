//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { setSelfSupplyPowers, setEnemySupplyPowers, setSelfDPSHealthPower, setEnemyDPSHealthPower } = require("../../services/data-service");
const trackUnitsService = require("../track-units/track-units-service");
const enemyTrackingService = require("./enemy-tracking-service")

module.exports = createSystem({
  name: 'EnemyTrackingSystem',
  type: 'agent',
  async onStep({ data, resources }) {
    const { units } = resources.get();
    enemyTrackingService.clearOutdatedMappedUnits(resources);
    enemyTrackingService.addUnmappedUnit(units);
    enemyTrackingService.setBaseThreats(resources);
    const { mappedEnemyUnits } = enemyTrackingService;
    setSelfSupplyPowers(data, mappedEnemyUnits);
    setEnemySupplyPowers(data, mappedEnemyUnits, trackUnitsService.selfUnits);
    setSelfDPSHealthPower(data, mappedEnemyUnits, enemyTrackingService.mappedEnemyUnits)
    setEnemyDPSHealthPower(data, mappedEnemyUnits, trackUnitsService.selfUnits)
  },
  async onEnemyFirstSeen({}, seenEnemyUnit) {
    enemyTrackingService.addEnemyUnit(seenEnemyUnit);
  },
  async onUnitDestroyed({}, unitDestroyed) {
    if (unitDestroyed.alliance === Alliance.ENEMY) enemyTrackingService.removeEnemyUnit(unitDestroyed);
  }
});