//@ts-check
"use strict"

const { WorkerRace, GasMineRace } = require("@node-sc2/core/constants/race-map");
const worldService = require("../../world-service");
const armyManagementService = require("../army-management/army-management-service");
const planService = require("../../../services/plan-service");
const unitTrainingService = require("../../../systems/unit-training/unit-training-service");
const { getById } = require("../unit-retrieval");

// economy-management-service.js

/**
 * Trains workers based on the conditions of the world and agent.
 * @param {World} world 
 * @param {Function} buildWorkersFunction - The function from training service to build workers.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const trainWorkers = (world, buildWorkersFunction) => {
  const { getFoodDifference, haveAvailableProductionUnitsFor, unitProductionAvailable, shortOnWorkers } = worldService;
  const { agent: { minerals, race }, resources } = world;

  // Early exit if essential properties are not defined.
  if (minerals === undefined || race === undefined) return [];

  const workerCount = getById(resources, [WorkerRace[race]]).length;
  const assignedWorkerCount = [...resources.get().units.getBases(), ...getById(resources, [GasMineRace[race]])]
    .reduce((acc, base) => (base.assignedHarvesters || 0) + acc, 0);
  const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
  const foodDifference = getFoodDifference(world);
  const sufficientMinerals = minerals < 512 || minimumWorkerCount <= 36;
  const productionPossible = race ? haveAvailableProductionUnitsFor(world, WorkerRace[race]) : false;
  const notOutpoweredOrNoUnits = !armyManagementService.outpowered || (armyManagementService.outpowered && !unitProductionAvailable);

  let shouldTrainWorkers;

  if (planService.bogIsActive) {
    shouldTrainWorkers = minimumWorkerCount <= 11;
  } else {
    shouldTrainWorkers = sufficientMinerals && (shortOnWorkers(world) || foodDifference > 0)
      && notOutpoweredOrNoUnits && productionPossible;
  }

  // Update the workersTrainingTendedTo flag and potentially add actions to train workers.
  const collectedActions = shouldTrainWorkers
    ? (unitTrainingService.workersTrainingTendedTo = false, [...buildWorkersFunction(world, foodDifference, true)])
    : (unitTrainingService.workersTrainingTendedTo = true, []);

  return collectedActions;
}

// You can export more functions here as your service grows
module.exports = {
  trainWorkers
};
