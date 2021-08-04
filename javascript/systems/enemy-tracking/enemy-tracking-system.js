//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { setSelfSupplyPowers, setEnemySupplyPowers } = require("../../services/shared-service");
const trackUnitsService = require("../track-units/track-units-service");
const enemyTrackingService = require("./enemy-tracking-service")

module.exports = createSystem({
  name: 'EnemyTrackingSystem',
  type: 'agent',
  async onStep({ data, resources }) {
    enemyTrackingService.setBaseThreats(resources);
    const { mappedEnemyUnits } = enemyTrackingService;
    setSelfSupplyPowers(data, mappedEnemyUnits);
    setEnemySupplyPowers(data, mappedEnemyUnits, trackUnitsService.selfUnits);
  }
});