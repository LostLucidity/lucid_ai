//@ts-check
"use strict";

// External library imports from @node-sc2/core
const { UnitType } = require("@node-sc2/core/constants");
const { SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

// Internal module imports
const { getClosestExpansion, isMoving } = require("./workerService");
const { findClosestMineralField } = require("../../features/shared/coreUtils");
const { getClosestUnitFromUnit } = require("../../features/shared/pathfinding/pathfinding");
const { getDistance } = require("../../features/shared/pathfinding/spatialCoreUtils");
const { findEnemyUnitsNear } = require("../../features/shared/scoutingUtils");
const { isTownhallInDanger } = require("../../features/shared/stateManagement");
const { isPendingContructing } = require("../../features/shared/workerCommonUtils");
const { getPendingOrders } = require("../../sharedServices");
const { setPendingOrders } = require("../../units/management/unitOrders");
const { getUnitsWithinDistance, createUnitCommand } = require("../../utils/common");
const { getNeediestMineralField, getMineralFieldAssignments } = require("../../utils/resourceUtils");

/**
 * Balances the worker distribution across all bases.
 * @param {World} world - The game world context.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions to reassign workers.
 */
function balanceWorkerDistribution(world, units, resources) {
  const townhalls = units.getBases();
  const gatheringWorkers = getGatheringWorkers(units);
  /** @type {Array<SC2APIProtocol.ActionRawUnitCommand>} */
  const collectedActions = [];
  const reassignedWorkers = new Set();

  /**
   * Finds nearby enemy units to a given townhall.
   * @param {Unit} townhall - The townhall to check around.
   * @returns {Array<Unit>} An array of nearby enemy units.
   */
  function findNearbyEnemies(townhall) {
    return findEnemyUnitsNear(units, townhall, 10);
  }

  /**
   * Checks if a townhall needs more workers.
   * @param {Unit} townhall - The townhall to check.
   * @returns {boolean} Whether the townhall needs more workers.
   */
  function isTownhallNeedy(townhall) {
    const { assignedHarvesters, idealHarvesters } = townhall;
    const nearbyEnemies = findNearbyEnemies(townhall);
    return (
      assignedHarvesters !== undefined &&
      idealHarvesters !== undefined &&
      assignedHarvesters < idealHarvesters &&
      nearbyEnemies.length === 0 &&
      !isTownhallInDanger(world, townhall, nearbyEnemies)
    );
  }

  /**
   * Gets potential donor townhalls.
   * @returns {Array<SC2APIProtocol.Unit>} An array of potential donor townhalls.
   */
  function getDonorTownhalls() {
    return townhalls.filter(donorTh => {
      const { assignedHarvesters: donorAssigned, idealHarvesters: donorIdeal } = donorTh;
      return (
        donorAssigned !== undefined &&
        donorIdeal !== undefined &&
        donorAssigned > donorIdeal
      );
    });
  }

  /**
   * Assigns a worker to a mineral field near a townhall.
   * @param {Unit} worker - The worker to assign.
   * @param {SC2APIProtocol.Unit} townhall - The townhall near which to assign the worker.
   */
  function assignWorkerToMineralField(worker, townhall) {
    const mineralFields = units.getMineralFields().filter(field => {
      const numWorkers = units.getWorkers().filter(worker => {
        const { orders } = worker;
        if (!orders) return false;
        return orders.some(order => order.targetUnitTag === field.tag);
      }).length;
      return (
        getDistance(field.pos, townhall.pos) < 8 &&
        (!field.labels.has('workerCount') || field.labels.get('workerCount') < 2) &&
        numWorkers < 2
      );
    });

    if (townhall.pos) {
      const [mineralFieldTarget] = units.getClosest(townhall.pos, mineralFields);
      if (mineralFieldTarget) {
        worker.labels.set('mineralField', mineralFieldTarget);
        mineralFieldTarget.labels.set('workerCount', (mineralFieldTarget.labels.get('workerCount') || 0) + 1);
        const unitCommands = gather(resources, worker, mineralFieldTarget, false);
        collectedActions.push(...unitCommands);
        unitCommands.forEach(unitCommand => setPendingOrders(worker, unitCommand));
        reassignedWorkers.add(worker.tag);
      }
    }
  }

  townhalls.forEach(townhall => {
    if (!townhall.pos || !isTownhallNeedy(townhall)) return;

    const potentialDonors = getDonorTownhalls();
    if (townhall.pos) {
      const [givingTownhall] = units.getClosest(townhall.pos, potentialDonors);
      if (givingTownhall && givingTownhall.pos && gatheringWorkers.length > 0) {
        const potentialWorkers = gatheringWorkers.filter(worker => !reassignedWorkers.has(worker.tag));
        const [donatingWorker] = units.getClosest(givingTownhall.pos, potentialWorkers);
        if (donatingWorker && donatingWorker.pos) {
          assignWorkerToMineralField(donatingWorker, townhall);
        }
      }
    }
  });

  return collectedActions;
}

/**
 * Finds the gathering order for a specific worker.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} worker - The worker unit to find the gathering order for.
 * @returns {SC2APIProtocol.UnitOrder | undefined} The gathering order or undefined if not found.
 */
function findGatheringOrder(units, worker) {
  // Retrieve pending orders using the getPendingOrders function
  const pendingOrders = getPendingOrders(worker);

  // Find a pending order targeting a mineral field
  const foundPendingOrder = pendingOrders.find(order =>
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
 * Retrieves gathering workers based on resource type.
 * 
 * @param {UnitResource} units 
 * @param {"minerals" | "vespene" | undefined} type 
 * @param {boolean} [firstOrderOnly=true] - Whether to filter based on the first order only.
 * @returns {Unit[]} An array of workers gathering the specified resource type.
 */
function getGatheringWorkers(units, type = undefined, firstOrderOnly = true) {
  const gatheringWorkers = units.getWorkers()
    .filter(worker => {
      return (
        worker.isGathering(type) ||
        getPendingOrders(worker).some(order =>
          order.abilityId !== undefined && gatheringAbilities.includes(order.abilityId)
        )
      );
    });

  if (firstOrderOnly) {
    return gatheringWorkers.filter(worker => {
      const { orders } = worker;
      if (orders === undefined) return false;

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
  /** @type {Array<SC2APIProtocol.ActionRawUnitCommand>} */
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
 * Creates an action for a worker to gather from a specific mineral field or the nearest one if not specified.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @param {Unit} worker - The worker unit to be assigned.
 * @param {Unit | null} mineralField - The mineral field to gather from, or null to pick the nearest one.
 * @param {boolean} queue - Whether or not to queue the action.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions for gathering.
 */
function gather(resources, worker, mineralField, queue = false) {
  /** @type {Array<SC2APIProtocol.ActionRawUnitCommand>} */
  const collectedActions = [];
  if (!worker.pos) { return collectedActions; }

  const units = resources.get().units;

  if (worker.labels.has('command') && !queue) {
    console.warn('WARNING! unit with command erroneously told to force gather! Forcing queue');
    queue = true;
  }

  const ownBases = units.getBases(Alliance.SELF).filter(b => b.buildProgress !== undefined && b.buildProgress >= 1);

  // Find the nearest mineral field if none is provided
  if (!mineralField) {
    const needyBases = ownBases.filter(base => (base.assignedHarvesters ?? 0) < (base.idealHarvesters ?? 0));
    const candidateBases = needyBases.length > 0 ? needyBases : ownBases;
    const targetBase = getClosestUnitFromUnit(resources, worker, candidateBases);

    if (!targetBase || !targetBase.pos) { return collectedActions; }

    [mineralField] = getUnitsWithinDistance(targetBase.pos, units.getMineralFields(), 10)
      .sort((a, b) => getTargetedByWorkers(units, a).length - getTargetedByWorkers(units, b).length);
  }

  if (mineralField && mineralField.pos) {
    const sendToGather = createUnitCommand(SMART, [worker], queue);
    sendToGather.targetUnitTag = mineralField.tag;
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
 * Retrieves workers targeting a specific unit.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} unit - The unit to check for targeted workers.
 * @returns {Unit[]} Array of workers targeting the specified unit.
 */
function getTargetedByWorkers(units, unit) {
  const workers = units.getWorkers().filter(worker => {
    const { orders } = worker;
    const pendingOrders = getPendingOrders(worker); // Use getPendingOrders instead of direct access
    if (orders === undefined) return false;
    return orders.some(order => order.targetUnitTag === unit.tag) ||
      pendingOrders.some(pendingOrder => pendingOrder.targetUnitTag === unit.tag);
  });
  return workers;
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
    /** @type {Point2D | undefined} */
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

  const isNotConstructing = !unitIsConstructing || (unitIsConstructing && unit.unitType === UnitType.PROBE);
  const probeAndMoving = unit.unitType === UnitType.PROBE && isMoving(unit);
  return (isNotConstructing && !unit.isAttacking() && !isPendingContructing(unit)) || probeAndMoving;
}

/**
 * Precomputes mineral fields that are close to any base.
 * @param {Unit[]} mineralFields - An array of mineral field units.
 * @param {Unit[]} bases - An array of base units.
 * @returns {Unit[]} A filtered array of mineral fields that are close to any base.
 */
function precomputeValidMineralFields(mineralFields, bases) {
  return mineralFields.filter(mineralField => {
    return bases.some(base => {
      return base.pos && getDistance(mineralField.pos, base.pos) <= 20;
    });
  });
}

/**
 * Reassign idle workers to mineral fields, ensuring there's a nearby base.
 * @param {World} world - The game context, including resources and actions.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of actions for reassigning workers.
 */
function reassignIdleWorkers(world) {
  const { resources } = world;
  const units = resources.get().units;
  const idleWorkers = units.getWorkers().filter(worker => worker.isIdle());
  const mineralFields = units.getMineralFields();
  const bases = units.getBases({ alliance: Alliance.SELF, buildProgress: 1 });

  // Precompute valid mineral fields
  const validMineralFields = precomputeValidMineralFields(mineralFields, bases);

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actionsToReturn = [];

  if (idleWorkers.length && validMineralFields.length && bases.length) {
    idleWorkers.forEach(worker => {
      const closestMineralField = findClosestMineralField(worker, validMineralFields);
      if (closestMineralField) {
        const gatherActions = gather(resources, worker, closestMineralField);
        actionsToReturn.push(...gatherActions);
      }
    });
  }

  return actionsToReturn;
}

module.exports = {
  balanceWorkerDistribution,
  gather,
  getGatheringWorkers,
  getWithLabelAvailable,
  handleWorkerAssignment,
  reassignIdleWorkers,
};
