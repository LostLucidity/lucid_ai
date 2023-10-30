//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const planService = require("../../services/plan-service");
const { shortOnWorkers } = require("../../src/world-service");
const unitTrainingService = require("./unit-training-service");
const armyManagementService = require("../../src/services/army-management/army-management-service");
const { trainCombatUnits } = require("../../src/services/training");

module.exports = createSystem({
  name: 'UnitTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const trainUnitConditions = [
      armyManagementService.outpowered,
      unitTrainingService.workersTrainingTendedTo && !planService.isPlanPaused,
      !shortOnWorkers(world) && !planService.isPlanPaused,
    ];
    if (trainUnitConditions.some(condition => condition)) {
      trainCombatUnits(world);
    }
  }
});
