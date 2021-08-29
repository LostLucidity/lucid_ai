//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const buildWorkers = require("../helper/build-workers");
const shortOnWorkers = require("../helper/short-on-workers");
const planService = require("../services/plan-service");
const enemyTrackingService = require("./enemy-tracking/enemy-tracking-service");
const { getSelfCombatSupply } = require("./track-units/track-units-service");
const { haveProductionUnitsFor } = require("./unit-training/unit-training-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const outSupplied = enemyTrackingService.getEnemyCombatSupply(data) > getSelfCombatSupply(world);
    const conditions = [
      !planService.pauseBuilding,
      agent.minerals < 512 || planService.trainingTypes.filter(type => haveProductionUnitsFor(world, type)).length === 0,
      shortOnWorkers(resources),
      !outSupplied,
    ];
    if (conditions.every(condition => condition)) {
      try { await buildWorkers(agent, data, resources); } catch(error) { console.log(error); }
    }
  }
});