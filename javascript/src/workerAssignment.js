//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { SMART } = require("@node-sc2/core/constants/ability");
const Ability = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

// Internal module imports
const { isPendingContructing } = require("./buildingCommons");
const { setPendingOrders } = require("./common");
const { getClosestUnitFromUnit } = require("./distance");
const { getDistance } = require("./geometryUtils");
const { getClosestExpansion, getPendingOrders, isMoving } = require("./sharedUtils");
const { getUnitsWithinDistance, createUnitCommand } = require("./utils");

/**
 * Assigns workers to mineral fields for optimal resource gathering.
 * 
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions to assign workers.
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
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions for the worker.
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
          collectedActions.push(...unitCommands);
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
 * Creates an action for a worker to gather from a specific mineral field.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @param {Unit} worker - The worker unit to be assigned.
 * @param {Unit} mineralField - The mineral field to gather from.
 * @param {boolean} queue - Whether or not to queue the action.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions for gathering.
 */
function gather(resources, worker, mineralField, queue) {
  const collectedActions = [];
  if (!worker.pos) { return collectedActions; }

  // Extract the UnitResource from the ResourceManager
  const units = resources.get().units;

  if (worker.labels.has('command') && !queue) {
    console.warn('WARNING! unit with command erroniously told to force gather! Forcing queue');
    queue = true;
  }

  const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress !== undefined && b.buildProgress >= 1);
  let target = mineralField;

  if (!target || !target.tag) {
    const needyBases = ownBases.filter(base => (base.assignedHarvesters ?? 0) < (base.idealHarvesters ?? 0));
    const candidateBases = needyBases.length > 0 ? needyBases : ownBases;
    const targetBase = getClosestUnitFromUnit(resources, worker, candidateBases);

    if (!targetBase || !targetBase.pos) { return collectedActions; }

    [target] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), 10)
      .sort((a, b) => getTargetedByWorkers(units, a).length - getTargetedByWorkers(units, b).length);
  }

  if (target && target.pos) {
    const sendToGather = createUnitCommand(SMART, [worker], queue);
    sendToGather.targetUnitTag = target.tag;
    collectedActions.push(sendToGather);
    setPendingOrders(worker, sendToGather);
  }

  return collectedActions;
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

/**
 * Balances the worker distribution across all bases.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions to reassign workers.
 */
function balanceWorkerDistribution(units, resources) {
  const townhalls = units.getBases();
  const gatheringWorkers = getGatheringWorkers(units);
  const collectedActions = []; // Initialize the array to collect actions

  // Logic to identify needy townhalls
  const needyTownhall = townhalls.filter(townhall => {
    // Ensure townhall has a valid position
    if (!townhall.pos) return false;

    // Check for enemy presence
    if (townhall['enemyUnits']) {
      let [closestEnemyUnit] = units.getClosest(townhall.pos, townhall['enemyUnits'], 1);
      if (closestEnemyUnit) {
        return townhall['selfDPSHealth'] >= closestEnemyUnit['selfDPSHealth'];
      }
    }
    return true;
  }).find(townhall => {
    const { assignedHarvesters, buildProgress, idealHarvesters } = townhall;
    if (assignedHarvesters === undefined || buildProgress === undefined || idealHarvesters === undefined) return false;

    // Check for excess harvesters
    let excessHarvesters = false;
    if (buildProgress < 1) {
      const mineralFields = units.getMineralFields().filter(field => {
        // Check if both field and townhall have valid positions before calculating the distance
        const distance = getDistance(field.pos, townhall.pos);
        return distance !== undefined && distance < 8;
      });
      excessHarvesters = assignedHarvesters < mineralFields.length * 2;
    } else {
      excessHarvesters = assignedHarvesters < idealHarvesters;
    }
    return excessHarvesters;
  });

  if (needyTownhall && needyTownhall.pos) {
    const possibleDonerThs = townhalls.filter(townhall => {
      const { assignedHarvesters, idealHarvesters } = townhall;
      return assignedHarvesters !== undefined && idealHarvesters !== undefined &&
        assignedHarvesters > idealHarvesters && townhall.pos;
    });

    const [givingTownhall] = units.getClosest(needyTownhall.pos, possibleDonerThs);
    if (givingTownhall && givingTownhall.pos && gatheringWorkers.length > 0) {
      const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringWorkers);
      if (donatingWorker && donatingWorker.pos) {
        // Logic for reassigning the worker
        const mineralFields = units.getMineralFields().filter(field => {
          const numWorkers = units.getWorkers().filter(worker => {
            const { orders } = worker;
            if (orders === undefined) { return false }
            return orders.some(order => order.targetUnitTag === field.tag);
          }).length;
          return (
            (getDistance(field.pos, needyTownhall.pos) < 8) &&
            (!field.labels.has('workerCount') || field.labels.get('workerCount') < 2) &&
            numWorkers < 2
          );
        });
        const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, mineralFields);
        if (mineralFieldTarget) {
          donatingWorker.labels.set('mineralField', mineralFieldTarget);
          if (!mineralFieldTarget.labels.has('workerCount')) {
            mineralFieldTarget.labels.set('workerCount', 1);
          } else {
            mineralFieldTarget.labels.set('workerCount', mineralFieldTarget.labels.get('workerCount') + 1);
          }
          const unitCommands = gather(resources, donatingWorker, mineralFieldTarget, false);
          collectedActions.push(...unitCommands);
          unitCommands.forEach(unitCommand => setPendingOrders(donatingWorker, unitCommand));
        } else {
          const mineralFields = units.getMineralFields();
          const [mineralFieldTarget] = units.getClosest(needyTownhall.pos, mineralFields);
          if (mineralFieldTarget) {
            donatingWorker.labels.delete('mineralField');
            const unitCommands = gather(resources, donatingWorker, mineralFieldTarget, false);
            collectedActions.push(...unitCommands);
          }
        }
      }
    }
  }

  // Return collected actions, ensuring the function always returns an array of ActionRawUnitCommand
  return collectedActions;
}

/**
 * Checks if a unit is available considering its current state and tasks.
 * @param {UnitResource} units - The units resource.
 * @param {Unit} unit - The unit to check.
 * @returns {boolean} - Returns true if the unit is available.
 */
function getWithLabelAvailable(units, unit) {
  let unitIsConstructing = unit.isConstructing();
  if (unitIsConstructing && unit.orders && unit.orders.length > 0) {
    let constructionPosition;

    // Determine construction position based on unit orders
    if (unit.orders[0].targetWorldSpacePos) {
      constructionPosition = unit.orders[0].targetWorldSpacePos;
    } else if (unit.orders[0].targetUnitTag) {
      const targetUnit = units.getByTag(unit.orders[0].targetUnitTag);
      if (targetUnit) {
        constructionPosition = targetUnit.pos;
      }
    }

    if (constructionPosition) {
      const buildingAtOrderPosition = units.getAlive().filter(u => u.isStructure()).find(structure => getDistance(structure.pos, constructionPosition) < 1);

      if (buildingAtOrderPosition) {
        const { buildProgress } = buildingAtOrderPosition;
        if (buildProgress === undefined) return false;
        if (buildProgress >= 1) {
          unitIsConstructing = false;
        }
      } else {
        unitIsConstructing = false;
      }
    }
  }

  const isNotConstructing = !unitIsConstructing || (unitIsConstructing && unit.unitType === Ability.PROBE);
  const probeAndMoving = unit.unitType === Ability.PROBE && isMoving(unit);
  return (isNotConstructing && !unit.isAttacking() && !isPendingContructing(unit)) || probeAndMoving;
}

module.exports = {
  assignWorkers,
  balanceWorkerDistribution,
  getWithLabelAvailable,
  getNeediestMineralField,
};
