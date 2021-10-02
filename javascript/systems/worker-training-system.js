//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { LARVA } = require("@node-sc2/core/constants/unit-type");
const buildWorkers = require("../helper/build-workers");
const shortOnWorkers = require("../helper/short-on-workers");
const planService = require("../services/plan-service");
const scoutService = require("./scouting/scouting-service");
const { haveAvailableProductionUnitsFor } = require("./unit-training/unit-training-service");
const unitTrainingService = require("./unit-training/unit-training-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const conditions = [
      haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]),
      !planService.isPlanPaused,
      agent.minerals < 512,
      shortOnWorkers(resources),
      !scoutService.outsupplied,
    ];
    if (conditions.every(condition => condition)) {
      unitTrainingService.workersTrainingTendedTo = false;
      try { await buildWorkers(agent, data, resources); } catch (error) { console.log(error); }
    } else {
      unitTrainingService.workersTrainingTendedTo = true;
    }
  }
});