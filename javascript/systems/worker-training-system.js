//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { getSupply, getTrainingSupply } = require("../helper");
const buildWorkers = require("../helper/build-workers");
const shortOnWorkers = require("../helper/short-on-workers");
const enemyTrackingService = require("../services/enemy-tracking-service");
const planService = require("../services/plan-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const inFieldSelfSupply = getSupply(data, units.getCombatUnits());
    const selfSupply = inFieldSelfSupply + getTrainingSupply(world, planService.trainingTypes);
    const outSupplied = enemyTrackingService.getEnemyCombatSupply(data) > selfSupply;
    if (!planService.pauseBuilding && shortOnWorkers(resources) && !outSupplied) {
      try { await buildWorkers(agent, data, resources); } catch(error) { console.log(error); }
    }
  }
});