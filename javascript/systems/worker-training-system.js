//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { WorkerRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const planService = require("../services/plan-service");
const { buildWorkers, shortOnWorkers, getFoodUsed } = require("../services/world-service");
const worldService = require("../services/world-service");
const { haveAvailableProductionUnitsFor } = require("./unit-training/unit-training-service");
const unitTrainingService = require("./unit-training/unit-training-service");

module.exports = createSystem({
  name: 'WorkerTrainingSystem',
  type: 'agent',
  async onGameStart(world) {
    await trainWorkers(world);
  },
  async onStep(world) {
    await trainWorkers(world);
  },
  async onUnitCreated(world, unit) {
    const { agent } = world;
    const { race } = agent;
    if (WorkerRace[race] === unit.unitType) {
      await trainWorkers(world);
    }
  },
});
/**
 * @param {World} world 
 * @returns {Promise<void>}
 */
async function trainWorkers(world) {
  const { agent, data, resources } = world;
  const { race } = agent;
  const { units } = resources.get();
  const workerCount = units.getById(WorkerRace[race]).length;
  const assignedWorkerCount = [...units.getBases(), ...units.getById(GasMineRace[race])].reduce((assignedWorkerCount, base) => base.assignedHarvesters + assignedWorkerCount, 0);
  const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
  const { outpowered, unitProductionAvailable } = worldService
  let conditionsMet = planService.bogIsActive && minimumWorkerCount <= 11;
  let foodDifference = getFoodDifference(world);
  if (!planService.bogIsActive) {
    const conditions = [
      haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]),
      !planService.isPlanPaused,
      agent.minerals < 512 || minimumWorkerCount <= 36,
      shortOnWorkers(world) || foodDifference > 0,
      !outpowered || (outpowered && !unitProductionAvailable)
    ];
    conditionsMet = conditions.every(condition => condition);
  }
  if (conditionsMet) {
    unitTrainingService.workersTrainingTendedTo = false;
    const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return; }
    const productionUnit = resources.get().units.getProductionUnits(WorkerRace[race]).find(u => u.noQueue && u.abilityAvailable(abilityId));
    try { if (productionUnit) await buildWorkers(world, foodDifference); } catch (error) { console.log(error); }
  } else {
    unitTrainingService.workersTrainingTendedTo = true;
  }
}

/**
 * @param {World} world
 * @returns {number}
 */
function getFoodDifference(world) {
  const { agent, data } = world;
  const { race } = agent;
  const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return 0; }
  let { plan, legacyPlan } = planService;
  const step = plan.find(step => step.food > getFoodUsed(world)) || legacyPlan.find(step => step[0] > getFoodUsed(world)); if (step === undefined) { return 0; }
  return (step.food || step[0]) - getFoodUsed(world);
}
