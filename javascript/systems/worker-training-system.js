//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const buildWorkers = require("../helper/build-workers");
const shortOnWorkers = require("../helper/short-on-workers");
const planService = require("../services/plan-service");
const scoutService = require("./scouting/scouting-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const conditions = [
      !planService.pauseBuilding,
      agent.minerals < 512,
      shortOnWorkers(resources),
      !scoutService.outsupplied,
    ];
    if (conditions.every(condition => condition)) {
      try { await buildWorkers(agent, data, resources); } catch (error) { console.log(error); }
    }
  }
});