//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const planService = require("../../services/plan-service");
const { shortOnWorkers, trainCombatUnits } = require("../../services/world-service");
const worldService = require("../../services/world-service");
const unitTrainingService = require("./unit-training-service");

module.exports = createSystem({
  name: 'UnitTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { outpowered } = worldService;
    const trainUnitConditions = [
      outpowered,
      unitTrainingService.workersTrainingTendedTo && !planService.isPlanPaused,
      !shortOnWorkers(world) && !planService.isPlanPaused,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      await trainCombatUnits(world);
    }
  }
});
