const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");

const { getGatheringWorkers, handleWorkerAssignment, getWithLabelAvailable } = require("../gameLogic/economy/workerAssignment");
const { isMining, isWorkerReservedForBuilding } = require("../gameLogic/economy/workerService");

/**
 * Assigns workers to mineral fields for optimal resource gathering.
 * 
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions to assign workers.
 */
function assignWorkers(resources) {
  const { map, units } = resources.get();
  /** @type {Array<SC2APIProtocol.ActionRawUnitCommand>} */
  const collectedActions = [];
  const gatheringMineralWorkers = getGatheringWorkers(units, 'minerals');
  const completedBases = units.getBases({ buildProgress: 1, alliance: Alliance.SELF });

  gatheringMineralWorkers.forEach(worker => {
    // Remove the 'builder' label from the worker if it exists
    if (worker.labels.has('builder')) {
      worker.labels.delete('builder');
    }

    // Check if the worker is reserved for building
    const isReserved = isWorkerReservedForBuilding(worker);

    // Reassign worker only if they are not reserved
    if (!isReserved) {
      collectedActions.push(...handleWorkerAssignment(worker, completedBases, map, units, resources));
    }
  });

  return collectedActions;
}

/**
 * Retrieves available builder units.
 * 
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getBuilders(units) {
  return [
    ...units.withLabel('builder').filter(builder => getWithLabelAvailable(units, builder)),
    ...units.withLabel('proxy').filter(proxy => getWithLabelAvailable(units, proxy))
  ].filter(worker => {
    const gatheringAndMining = worker.isGathering() && isMining(units, worker);
    const isConstructingDrone = worker.isConstructing() && worker.unitType === UnitType.DRONE;
    return !worker.isReturning() && !gatheringAndMining && !isConstructingDrone;
  });
}

// Exporting the functions
module.exports = {
  assignWorkers,
  getBuilders,
};
