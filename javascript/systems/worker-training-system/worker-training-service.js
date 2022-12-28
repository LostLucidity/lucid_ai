// @ts-check
"use strict"

const { WorkerRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const { addEarmark } = require("../../services/data-service");
const planService = require("../../services/plan-service");
const { shortOnWorkers, buildWorkers, getFoodUsed } = require("../../services/world-service");
const worldService = require("../../services/world-service");
const unitTrainingService = require("../unit-training/unit-training-service");
const { haveAvailableProductionUnitsFor } = require("../unit-training/unit-training-service");

const workerTrainingService = {
  /**
   * @param {World} world
   * @returns {number}
   */
  getFoodDifference: (world) => {
    const { agent, data } = world;
    const { race } = agent;
    const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return 0; }
    let { plan, legacyPlan } = planService;
    const foodUsed = getFoodUsed(world);
    const step = plan.find(step => step.food > foodUsed) || legacyPlan.find(step => step[0] > foodUsed); if (step === undefined) { return 0; }
    const foodDifference = (step.food || step[0]) - getFoodUsed(world);
    // get affordableFoodDifference
    let affordableFoodDifference = 0;
    for (let i = 0; i < foodDifference; i++) {
      if (agent.canAfford(WorkerRace[agent.race])) {
        affordableFoodDifference++;
        addEarmark(data, data.getUnitTypeData(WorkerRace[agent.race]))
      } else {
        break;
      }
    }
    return affordableFoodDifference;
  },
  /**
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  trainWorkers: (world) => {
    const { agent, data, resources } = world;
    const { race } = agent;
    const { units } = resources.get();
    const collectedActions = [];
    const workerCount = units.getById(WorkerRace[race]).length;
    const assignedWorkerCount = [...units.getBases(), ...units.getById(GasMineRace[race])].reduce((assignedWorkerCount, base) => base.assignedHarvesters + assignedWorkerCount, 0);
    const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
    const { outpowered, unitProductionAvailable } = worldService
    let conditionsMet = planService.bogIsActive && minimumWorkerCount <= 11;
    let foodDifference = workerTrainingService.getFoodDifference(world);
    if (!planService.bogIsActive) {
      const conditions = [
        agent.canAfford(WorkerRace[agent.race]),
        haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]),
        agent.minerals < 512 || minimumWorkerCount <= 36,
        shortOnWorkers(world) || foodDifference > 0,
        !outpowered || (outpowered && !unitProductionAvailable)
      ];
      conditionsMet = conditions.every(condition => condition);
    }
    if (conditionsMet) {
      unitTrainingService.workersTrainingTendedTo = false;
      const { abilityId } = data.getUnitTypeData(WorkerRace[race]); if (abilityId === undefined) { return []; }
      const productionUnit = resources.get().units.getProductionUnits(WorkerRace[race]).find(u => u.noQueue && u.abilityAvailable(abilityId));
      try {
        if (productionUnit) collectedActions.push(...buildWorkers(world, foodDifference));
      } catch (error) { console.log(error); }
    } else {
      unitTrainingService.workersTrainingTendedTo = true;
    }
    return collectedActions;
  }
}

module.exports = workerTrainingService;