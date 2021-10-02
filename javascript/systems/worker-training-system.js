//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA } = require("@node-sc2/core/constants/unit-type");
const buildWorkers = require("../helper/build-workers");
const shortOnWorkers = require("../helper/short-on-workers");
const planService = require("../services/plan-service");
const scoutService = require("./scouting/scouting-service");
const unitTrainingService = require("./unit-training/unit-training-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const idleBases = units.getBases(Alliance.SELF).filter(base => base.buildProgress >= 1 && base.isIdle()).length > 0;
    const idleLarva = units.getById(LARVA).length > 0;
    const conditions = [
      idleBases || idleLarva,
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