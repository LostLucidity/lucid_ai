//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { WorkerRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const shortOnWorkers = require("../helper/short-on-workers");
const planService = require("../services/plan-service");
const { buildWorkers } = require("../services/world-service");
const worldService = require("../services/world-service");
const { haveAvailableProductionUnitsFor } = require("./unit-training/unit-training-service");
const unitTrainingService = require("./unit-training/unit-training-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, resources } = world;
    const { race } = agent;
    const { units } = resources.get();
    const workerCount = units.getById(WorkerRace[race]).length;
    const assignedWorkerCount = [...units.getBases(), ...units.getById(GasMineRace[race])].reduce((assignedWorkerCount, base) => base.assignedHarvesters + assignedWorkerCount, 0);
    const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
    const { outpowered, unitProductionAvailable } = worldService
    const conditions = [
      haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]),
      !planService.isPlanPaused,
      agent.minerals < 512 || minimumWorkerCount <= 34,
      shortOnWorkers(resources),
      !outpowered || (outpowered && !unitProductionAvailable)
    ];
    if (conditions.every(condition => condition)) {
      unitTrainingService.workersTrainingTendedTo = false;
      const { abilityId } = world.data.getUnitTypeData(WorkerRace[race])
      const productionUnit = resources.get().units.getProductionUnits(WorkerRace[race]).find(u => u.noQueue && u.abilityAvailable(abilityId));
      try { if (productionUnit) await buildWorkers(world); } catch (error) { console.log(error); }
    } else {
      unitTrainingService.workersTrainingTendedTo = true;
    }
  }
});