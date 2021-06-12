//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core")
const enemyTrackingService = require("./enemy-tracking-service")

module.exports = createSystem({
  name: 'EnemyTrackingSystem',
  type: 'agent',
  async onStep({ resources }) {
    enemyTrackingService.setBaseThreats(resources);
  }
});