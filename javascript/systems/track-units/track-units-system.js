//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { setSelfSupplyPowers, setEnemySupplyPowers } = require("../../services/data-service");
const { setArmorUpgradeLevel, setAttackUpgradeLevel } = require("../../services/units-service");
const { setSelfDPSHealthPower, setEnemyDPSHealthPower, setTotalSelfDPSHealth } = require("../../services/world-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const { setSelfCombatSupply } = require("./track-units-service");
const trackUnitsService = require("./track-units-service");

module.exports = createSystem({
  name: 'TrackUnitsSystem',
  type: 'agent',
  async onStep(world) {
    const { data, resources } = world;
    const { units } = resources.get();
    const currentUnits = units.getAlive(Alliance.SELF);
    var inCurrent = {};
    currentUnits.forEach(unit => inCurrent[unit.tag] = true);
    trackUnitsService.missingUnits.push(...trackUnitsService.previousUnits.filter(unit => {
      return !inCurrent[unit.tag] && !unit.labels.get('dead');
    }));
    trackUnitsService.missingUnits = trackUnitsService.missingUnits.filter(unit => !currentUnits.some(currentUnit => currentUnit.tag === unit.tag));
    trackUnitsService.previousUnits = currentUnits;
    let selfUnits = [...currentUnits, ...trackUnitsService.missingUnits];
    setSelfCombatSupply(world);
    trackUnitsService.selfUnits = selfUnits;
    setSelfSupplyPowers(data, selfUnits)
    setEnemySupplyPowers(data, selfUnits, enemyTrackingService.enemyUnits);
    setSelfDPSHealthPower(world, selfUnits, enemyTrackingService.mappedEnemyUnits);
    setEnemyDPSHealthPower(world, selfUnits, enemyTrackingService.enemyUnits);
    setArmorUpgradeLevel(selfUnits);
    setAttackUpgradeLevel(selfUnits);
    setTotalSelfDPSHealth(world);
  },
  async onUnitDestroyed({}, destroyedUnit) {
    trackUnitsService.missingUnits = trackUnitsService.missingUnits.filter(unit => destroyedUnit.tag !== unit.tag);
  },
});