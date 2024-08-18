const { UnitType } = require("@node-sc2/core/constants");

const { getWithLabelAvailable } = require("../../gameLogic/economy/workerAssignment");
const { isMining } = require("../../gameLogic/economy/workerService");

/**
 * Retrieves available builder units.
 * 
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getAvailableBuilders(units) {
  return [
    ...units.withLabel('builder').filter(builder => getWithLabelAvailable(units, builder)),
    ...units.withLabel('proxy').filter(proxy => getWithLabelAvailable(units, proxy))
  ].filter(worker => {
    if (worker.isReturning()) return false;

    if (worker.isGathering() && isMining(units, worker)) return false;

    if (worker.isConstructing() && worker.unitType === UnitType.DRONE) return false;

    return true;
  });
}

module.exports = {
  getAvailableBuilders,
};
