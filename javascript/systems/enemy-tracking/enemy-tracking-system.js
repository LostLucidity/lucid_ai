//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { setSelfSupplyPowers, setEnemySupplyPowers } = require("../../services/data-service");
const { setArmorUpgradeLevel, setAttackUpgradeLevel } = require("../../services/unit-service");
const { setSelfDPSHealthPower, setEnemyDPSHealthPower, setTotalEnemyDPSHealth } = require("../../src/world-service");
const trackUnitsService = require("../track-units/track-units-service");
const { setEnemyUnitPositions } = require("./enemy-tracking-service");
const enemyTrackingService = require("./enemy-tracking-service")

module.exports = createSystem({
  name: 'EnemyTrackingSystem',
  type: 'agent',
  async onStep(world) {
    const { data, resources } = world;
    const { units } = resources.get();
    enemyTrackingService.clearOutdatedMappedUnits(resources);
    enemyTrackingService.addUnmappedUnit(units);
    enemyTrackingService.setBaseThreats(resources);
    const { mappedEnemyUnits } = enemyTrackingService;
    setEnemyUnitPositions();
    const { selfUnits } = trackUnitsService;
    setSelfSupplyPowers(data, mappedEnemyUnits);
    setEnemySupplyPowers(data, mappedEnemyUnits, selfUnits);
    setSelfDPSHealthPower(world, mappedEnemyUnits, selfUnits);
    setEnemyDPSHealthPower(world, mappedEnemyUnits, selfUnits);
    setArmorUpgradeLevel(units.getAlive(Alliance.ENEMY));
    setAttackUpgradeLevel(units.getAlive(Alliance.ENEMY));
    setTotalEnemyDPSHealth(world);
  },
  async onEnemyFirstSeen({ }, seenEnemyUnit) {
    enemyTrackingService.addEnemyUnit(seenEnemyUnit);
  },
  async onUnitDestroyed({ }, unitDestroyed) {
    if (unitDestroyed.alliance === Alliance.ENEMY) enemyTrackingService.removeEnemyUnit(unitDestroyed);
  }
});
