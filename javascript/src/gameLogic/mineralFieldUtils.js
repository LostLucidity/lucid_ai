// Utility functions related to mineral field assignments and selection

const { getPendingOrders } = require("../sharedServices");


/**
 * @param {UnitResource} units
 * @param {Unit[]} mineralFields
 * @returns {{ count: number; mineralContents: number | undefined; mineralFieldTag: string | undefined; targetedCount: number; }[]}
 */
function getMineralFieldAssignments(units, mineralFields) {
  const harvestingMineralWorkers = units.getWorkers().filter(worker => worker.isHarvesting('minerals'));
  return mineralFields.map(mineralField => {
    const targetMineralFieldWorkers = harvestingMineralWorkers.filter(worker => {
      const assignedMineralField = worker.labels.get('mineralField');
      return assignedMineralField && assignedMineralField.tag === mineralField.tag;
    });
    mineralField.labels.set('workerCount', targetMineralFieldWorkers.length);
    const targetedMineralFieldWorkers = harvestingMineralWorkers.filter(worker => {
      const { orders } = worker;
      if (orders === undefined) return false;
      const pendingOrders = getPendingOrders(worker);
      const allOrders = [...orders, ...pendingOrders];
      return allOrders.some(order => {
        if (order.targetUnitTag === mineralField.tag && worker.labels.has('mineralField')) {
          return true;
        } else {
          return false;
        }
      });
    });
    return {
      count: targetMineralFieldWorkers.length,
      mineralContents: mineralField.mineralContents,
      mineralFieldTag: mineralField.tag,
      targetedCount: targetedMineralFieldWorkers.length,
    };
  });
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} mineralFields
 * @returns {Unit | undefined}}
 */
function getNeediestMineralField(units, mineralFields) {
  const mineralFieldCounts = getMineralFieldAssignments(units, mineralFields)
    .filter(mineralFieldAssignments => mineralFieldAssignments.count < 2 && mineralFieldAssignments.targetedCount < 2)
    .sort((a, b) => {
      const { mineralContents: aContents } = a;
      const { mineralContents: bContents } = b;
      if (aContents === undefined || bContents === undefined) return 0;
      return bContents - aContents
    }).sort((a, b) => {
      return Math.max(a.count, a.targetedCount) - Math.max(b.count, b.targetedCount);
    });
  if (mineralFieldCounts.length > 0) {
    const [mineralFieldCount] = mineralFieldCounts;
    const { mineralFieldTag } = mineralFieldCount;
    if (mineralFieldTag) {
      return units.getByTag(mineralFieldTag);
    }
  }
}

// Exporting the functions to make them available for other modules
module.exports = {
  getMineralFieldAssignments,
  getNeediestMineralField,
};
