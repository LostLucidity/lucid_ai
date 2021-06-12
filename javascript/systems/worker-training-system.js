//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { getSupply, getTrainingSupply } = require("../helper");
const buildWorkers = require("../helper/build-workers");
const shortOnWorkers = require("../helper/short-on-workers");
const planService = require("../services/plan-service");
const enemyTrackingService = require("./enemy-tracking/enemy-tracking-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const inFieldSelfSupply = getSupply(data, units.getCombatUnits());
    const selfSupply = inFieldSelfSupply + getTrainingSupply(world, planService.trainingTypes);
    const outSupplied = enemyTrackingService.getEnemyCombatSupply(data) > selfSupply;
    const conditions = [
      !planService.pauseBuilding,
      agent.minerals < 512,
      shortOnWorkers(resources),
      !outSupplied,
    ];
    if (conditions.every(condition => condition)) {
      try { await buildWorkers(agent, data, resources); } catch(error) { console.log(error); }
    }
  }
});