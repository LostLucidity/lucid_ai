// sharedWorkerUtils.js

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");

const { getWithLabelAvailable, getGatheringWorkers, handleWorkerAssignment } = require("../utils/economy/workerAssignment");
const { isMining } = require("../utils/worker/workerUtils");

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
    const workerActions = handleWorkerAssignment(worker, completedBases, map, units, resources);
    collectedActions.push(...workerActions);
  });

  return collectedActions;
}

/**
 * 
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getBuilders(units) {
  let builders = [
    ...units.withLabel('builder').filter(builder => getWithLabelAvailable(units, builder)),
    ...units.withLabel('proxy').filter(proxy => getWithLabelAvailable(units, proxy)),
  ].filter(worker => {
    const gatheringAndMining = worker.isGathering() && isMining(units, worker);
    const isConstructingDrone = worker.isConstructing() && worker.unitType === UnitType.DRONE;
    return !worker.isReturning() && !gatheringAndMining && !isConstructingDrone;
  });
  return builders;
}

// Export the shared functionalities
module.exports = {
  assignWorkers,
  getBuilders,
};
