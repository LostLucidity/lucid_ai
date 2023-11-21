//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getClosestExpansion, getPendingOrders, getUnitsWithinDistance, createUnitCommand } = require("./utils");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");
const { getClosestUnitFromUnit } = require("./distance");
const { SMART } = require("@node-sc2/core/constants/ability");
const { getDistance } = require("./geometryUtils");
const { setPendingOrders, convertToAction } = require("./common");

/**
 * Assigns workers to mineral fields for optimal resource gathering.
 * 
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.Action>} An array of actions to assign workers.
 */
function assignWorkers(resources) {
  const { map, units } = resources.get();
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
 * Handles the assignment of a single worker to a mineral field.
 * 
 * @param {Unit} worker - The worker unit to be assigned.
 * @param {Array<Unit>} completedBases - Array of completed bases.
 * @param {MapResource} map - The map resource object from the bot.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.Action>} An array of actions for the worker.
 */
function handleWorkerAssignment(worker, completedBases, map, units, resources) {
  const collectedActions = [];
  const { pos: workerPos } = worker;
  if (!workerPos) return collectedActions;

  const [closestBase] = units.getClosest(workerPos, completedBases, 1);
  if (!closestBase || !closestBase.pos) return collectedActions;

  const basePos = closestBase.pos;
  if (!basePos) return collectedActions;

  const closestExpansion = getClosestExpansion(map, basePos);
  if (!closestExpansion) return collectedActions;

  const mineralFields = units.getMineralFields().filter(mineralField => {
    if (!mineralField.pos) return false;
    const distance = getDistance(basePos, mineralField.pos);
    return distance !== undefined && distance < 14;
  });

  const assignedMineralField = worker.labels.get('mineralField');
  if (assignedMineralField && assignedMineralField.tag !== undefined) {
    let currentMineralField = units.getByTag(assignedMineralField.tag);
    if (currentMineralField) {
      const neediestMineralField = getNeediestMineralField(units, mineralFields);
      const leastNeediestMineralField = getLeastNeediestMineralField(units, mineralFields);

      if (neediestMineralField && leastNeediestMineralField) {
        const neediestMineralContents = neediestMineralField.mineralContents || 0;
        const leastNeediestMineralContents = leastNeediestMineralField.mineralContents || 0;

        const neediestDoublingLeastNeediest = neediestMineralContents > leastNeediestMineralContents * 2;
        if (assignedMineralField.tag !== neediestMineralField.tag && neediestDoublingLeastNeediest) {
          worker.labels.set('mineralField', neediestMineralField);
          neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
          currentMineralField.labels.set('workerCount', currentMineralField.labels.get('workerCount') - 1);
        }
      }

      const gatheringOrder = findGatheringOrder(units, worker);
      if (gatheringOrder && gatheringOrder.targetUnitTag !== currentMineralField.tag) {
        if (currentMineralField.labels.get('workerCount') < 3) {
          const unitCommands = gather(resources, worker, currentMineralField, false);
          collectedActions.push(...unitCommands.map(cmd => /** @type {SC2APIProtocol.Action} */(cmd)));
        } else {
          worker.labels.delete('mineralField');
          currentMineralField.labels.set('workerCount', currentMineralField.labels.get('workerCount') - 1);
        }
      }
    } else {
      worker.labels.delete('mineralField');
    }
  } else {
    const neediestMineralField = getNeediestMineralField(units, mineralFields);
    if (neediestMineralField) {
      const unitCommands = gather(resources, worker, neediestMineralField, false);
      collectedActions.push(...unitCommands);
      worker.labels.set('mineralField', neediestMineralField);
      neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
    }
  }

  return collectedActions;
}

/**
 * 
 * @param {UnitResource} units 
 * @param {"minerals" | "vespene" | undefined} type 
 * @returns 
 */
function getGatheringWorkers(units, type = undefined, firstOrderOnly = true) {
  const gatheringWorkers = units.getWorkers()
    .filter(worker => {
      return (
        worker.isGathering(type) ||
        (worker['pendingOrders'] && worker['pendingOrders'].some((/** @type {{ abilityId: number | undefined; }} */ order) =>
          order.abilityId !== undefined && gatheringAbilities.includes(order.abilityId)
        ))
      );
    });
  if (firstOrderOnly) {
    return gatheringWorkers.filter(worker => {
      const { orders } = worker; if (orders === undefined) return false;
      const pendingOrders = getPendingOrders(worker);
      const gatheringOrders = [...orders, ...pendingOrders].filter(order =>
        order.abilityId !== undefined && gatheringAbilities.includes(order.abilityId)
      );
      return gatheringOrders.length > 0;
    });
  }
  return gatheringWorkers;
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} mineralFields
 * @returns {Unit | undefined}}
 */
function getNeediestMineralField (units, mineralFields) {
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

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit 
 * @param {Unit | undefined} mineralField
 * @param {boolean} queue
 * @returns {SC2APIProtocol.Action[]} The array of gather action commands.
 */
function gather(resources, unit, mineralField, queue = true) {
  const { units } = resources.get();
  const { pos: unitPos } = unit;
  const collectedActions = [];
  if (unitPos === undefined) { return collectedActions; }
  if (unit.labels.has('command') && queue === false) {
    console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
    queue = true;
  }
  const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress !== undefined && b.buildProgress >= 1);
  let target;
  const localMaxDistanceOfMineralFields = 10;
  if (mineralField && mineralField.tag) {
    target = mineralField;
  } else {
    let targetBase;
    const needyBases = ownBases.filter(base => {
      const { assignedHarvesters, idealHarvesters } = base;
      if (assignedHarvesters === undefined || idealHarvesters === undefined) { return false; }
      return assignedHarvesters < idealHarvesters
    });
    const candidateBases = needyBases.length > 0 ? needyBases : ownBases;
    targetBase = getClosestUnitFromUnit(resources, unit, candidateBases);
    if (targetBase === undefined || targetBase.pos === undefined) { return collectedActions; }
    [target] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), localMaxDistanceOfMineralFields).sort((a, b) => {
      const targetedByWorkersACount = getTargetedByWorkers(units, a).length;
      const targetedByWorkersBCount = getTargetedByWorkers(units, b).length;
      return targetedByWorkersACount - targetedByWorkersBCount;
    });
  }
  if (target) {
    const { pos: targetPos } = target; if (targetPos === undefined) { return collectedActions; }
    const sendToGather = createUnitCommand(SMART, [unit]);
    sendToGather.targetUnitTag = target.tag;
    sendToGather.queueCommand = queue;
    collectedActions.push(sendToGather);
    setPendingOrders(unit, sendToGather);
  }
  return collectedActions.map(cmd => convertToAction(cmd));
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} mineralFields
 * @returns {Unit | undefined}
 */
function getLeastNeediestMineralField(units, mineralFields) {
  const mineralFieldCounts = getMineralFieldAssignments(units, mineralFields)
    .filter(mineralFieldAssignments => mineralFieldAssignments.count <= 2 && mineralFieldAssignments.targetedCount <= 2)
    .sort((a, b) => {
      const { mineralContents: aContents } = a;
      const { mineralContents: bContents } = b;
      if (aContents === undefined || bContents === undefined) return 0;
      return aContents - bContents;
    }).sort((a, b) => b.count - a.count);
  if (mineralFieldCounts.length > 0) {
    const [mineralFieldCount] = mineralFieldCounts;
    const { mineralFieldTag } = mineralFieldCount;
    if (mineralFieldTag) {
      return units.getByTag(mineralFieldTag);
    }
  }
}

/**
 * Finds the gathering order for a specific worker.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} worker - The worker unit to find the gathering order for.
 * @returns {SC2APIProtocol.UnitOrder | undefined} The gathering order or undefined if not found.
 */
function findGatheringOrder(units, worker) {
  const foundPendingOrder = worker['pendingOrders'] && worker['pendingOrders'].find(order =>
    order.targetUnitTag && units.getByTag(order.targetUnitTag).isMineralField()
  );

  if (foundPendingOrder) {
    return foundPendingOrder;
  } else {
    // Check if worker.orders is defined and filter out any undefined abilityId
    if (worker.orders) {
      return worker.orders.find(order =>
        order.abilityId !== undefined && gatheringAbilities.includes(order.abilityId)
      );
    } else {
      // Handle the case when worker.orders is undefined
      return undefined;
    }
  }
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} mineralFields
 * @returns {{ count: number; mineralContents: number | undefined; mineralFieldTag: string | undefined; targetedCount: number; }[]}
 */
function getMineralFieldAssignments (units, mineralFields) {
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
 * Retrieves workers targeting a specific unit.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} unit - The unit to check for targeted workers.
 * @returns {Unit[]} Array of workers targeting the specified unit.
 */
function getTargetedByWorkers(units, unit) {
  const workers = units.getWorkers().filter(worker => {
    const { orders } = worker;
    const pendingOrders = worker['pendingOrders'];
    if (orders === undefined) return false;
    return orders.some(order => order.targetUnitTag === unit.tag) ||
      (pendingOrders && pendingOrders.some((/** @type {{ targetUnitTag: string | undefined; }} */ pendingOrder) => pendingOrder.targetUnitTag === unit.tag));
  });
  return workers;
}

module.exports = {
  assignWorkers
};
