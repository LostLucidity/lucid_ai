//@ts-check
"use strict";

// External library imports from @node-sc2/core
const { UnitType } = require("@node-sc2/core/constants");
const { SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

// Internal module imports
const { isMoving, isWorkerReservedForBuilding } = require("./workerService");
const config = require("../../../config/config");
const { getUnitsWithinDistance, createUnitCommand } = require("../../core/common");
const { getClosestUnitFromUnit, getClosestExpansion } = require("../../features/shared/pathfinding/pathfinding");
const { isPendingConstructing } = require("../../features/shared/workerCommonUtils");
const { getPendingOrders } = require("../../services/sharedServices");
const { setPendingOrders } = require("../../units/management/unitOrders");
const { findClosestMineralField } = require("../../utils/coreUtils");
const { getNeediestMineralField, getMineralFieldAssignments } = require("../../utils/resourceUtils");
const { findEnemyUnitsNear } = require("../../utils/scoutingUtils");
const { getDistance } = require("../../utils/spatialCoreUtils");
const { isTownhallInDanger } = require("../../utils/stateManagement");

/**
 * Checks if the mineral fields near a townhall are saturated.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} townhall - The townhall to check.
 * @returns {boolean} Whether the nearby mineral fields are saturated.
 */
function areMineralFieldsSaturated(units, townhall) {
  const mineralFields = units.getMineralFields().filter(field =>
    getDistance(field.pos, townhall.pos) < 8
  );
  const totalWorkers = mineralFields.reduce((count, field) => {
    return count + (field.labels.get('workerCount') || 0);
  }, 0);
  const maxWorkers = mineralFields.length * 2; // Assuming 2 workers per field for saturation
  return totalWorkers >= maxWorkers;
}

/**
 * Assigns workers to mineral fields for optimal resource gathering.
 * 
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions to assign workers.
 */
function assignWorkersToMinerals(resources) {
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
      collectedActions.push(...assignWorkerToField(worker, completedBases, map, units, resources));
    }
  });

  return collectedActions;
}

/**
 * Assigns a worker to the most suitable mineral field near a townhall.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} worker - The worker to assign.
 * @param {Unit} townhall - The townhall near which to assign the worker.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} collectedActions - Array to collect actions.
 * @param {Set<number>} reassignedWorkers - Set of reassigned worker tags.
 * @param {Unit[]} mineralFieldsCache - Cached mineral fields.
 */
function assignWorkerToMineralField(units, worker, townhall, resources, collectedActions, reassignedWorkers, mineralFieldsCache) {
  const mineralFieldTarget = findBestMineralField(units, worker, townhall, mineralFieldsCache); // Use cached fields

  if (mineralFieldTarget) {
    worker.labels.set('mineralField', mineralFieldTarget);
    mineralFieldTarget.labels.set('workerCount', (mineralFieldTarget.labels.get('workerCount') || 0) + 1);
    const unitCommands = gather(resources, worker, mineralFieldTarget, false);
    collectedActions.push(...unitCommands);
    unitCommands.forEach(unitCommand => setPendingOrders(worker, unitCommand));
    if (typeof worker.tag === 'number') {
      reassignedWorkers.add(worker.tag);
    }
  }
}

/**
 * Balance worker distribution across bases.
 * @param {World} world
 * @param {UnitResource} units
 * @param {ResourceManager} resources
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function balanceWorkers(world, units, resources, actionList) {
  const averageGatheringTime = config.getAverageGatheringTime();

  actionList.push(...distributeWorkersAcrossBases(world, units, resources, averageGatheringTime));
}

/**
 * Balances the worker distribution across all bases, including townhalls under construction.
 * @param {World} world - The game world context.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {ResourceManager} resources - The resource manager from the bot.
 * @param {number} averageGatheringTime - The average time it takes for a worker to gather resources.
 * @returns {Array<SC2APIProtocol.ActionRawUnitCommand>} An array of actions to reassign workers.
 */
function distributeWorkersAcrossBases(world, units, resources, averageGatheringTime) {
  const townhalls = units.getBases();
  const gatheringWorkers = getGatheringWorkers(units);
  /** @type {Array<SC2APIProtocol.ActionRawUnitCommand>} */
  const collectedActions = [];
  const reassignedWorkers = new Set();

  // Cache the mineral fields to avoid multiple calls to units.getMineralFields()
  const mineralFieldsCache = units.getMineralFields(); // Declare and cache the result

  // Loop through each townhall
  townhalls.forEach(townhall => {
    if (!townhall.pos || !isTownhallNeedy(world, townhall, averageGatheringTime, units)) return;

    const potentialDonors = getDonorTownhalls(townhalls);
    if (townhall.pos) {
      const [givingTownhall] = units.getClosest(townhall.pos, potentialDonors);
      if (givingTownhall && givingTownhall.pos && gatheringWorkers.length > 0) {
        const potentialWorkers = gatheringWorkers.filter(worker => !reassignedWorkers.has(worker.tag));
        const [donatingWorker] = units.getClosest(givingTownhall.pos, potentialWorkers);
        if (donatingWorker && donatingWorker.pos) {
          // Pass cached mineral fields instead of calling units.getMineralFields() again
          assignWorkerToMineralField(units, donatingWorker, townhall, resources, collectedActions, reassignedWorkers, mineralFieldsCache);
        }
      }
    }
  });

  return collectedActions;
}

/**
 * Estimates the time it would take for a worker to gather resources from a mineral field and return to the townhall.
 * @param {Unit} worker - The worker unit.
 * @param {Unit} mineralField - The mineral field unit.
 * @param {number} averageGatheringTime - The average time it takes for a worker to gather resources.
 * @returns {number} The estimated time to gather and return resources.
 */
function estimateGatherAndReturnTime(worker, mineralField, averageGatheringTime) {
  const baseWorkerSpeed = worker.data().movementSpeed || 2.81; // Fallback to default speed if undefined
  const workerSpeed = baseWorkerSpeed * 1.4; // Adjust for Faster game speed
  const distanceToField = getDistance(worker.pos, mineralField.pos);
  const returnTime = distanceToField / workerSpeed;
  return distanceToField / workerSpeed + averageGatheringTime + returnTime;
}

/**
 * Finds the most suitable mineral field for a worker near a townhall.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} worker - The worker to assign.
 * @param {Unit} townhall - The townhall near which to assign the worker.
 * @param {Unit[]} mineralFieldsCache - Cached mineral fields.
 * @returns {Unit|null} The most suitable mineral field, or null if none found.
 */
function findBestMineralField(units, worker, townhall, mineralFieldsCache) {
  if (!worker.pos) {
    return null;
  }

  // Use cached mineral fields instead of calling units.getMineralFields()
  const suitableMineralFields = mineralFieldsCache.filter(field => {
    const workerCount = field.labels.get('workerCount') || 0;
    const numWorkersAssigned = units.getWorkers().filter(w => {
      return w.orders && w.orders.some(order => order.targetUnitTag === field.tag);
    }).length;

    return (
      getDistance(field.pos, townhall.pos) < 8 &&
      workerCount < 2 &&
      numWorkersAssigned < 2
    );
  });

  return suitableMineralFields.length > 0 ? units.getClosest(worker.pos, suitableMineralFields)[0] : null;
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
 * Finds nearby enemy units to a given townhall.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} townhall - The townhall to check around.
 * @returns {Array<Unit>} An array of nearby enemy units.
 */
function findNearbyEnemies(units, townhall) {
  return findEnemyUnitsNear(units, townhall, 10);
}

/**
 * Finds townhalls that have more workers than ideal.
 * @param {Unit[]} townhalls - Array of townhalls.
 * @returns {Unit[]} An array of townhalls with excess workers.
 */
function getDonorTownhalls(townhalls) {
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
 * Retrieves gathering workers based on resource type.
 * 
 * @param {UnitResource} units 
 * @param {"minerals" | "vespene" | undefined} type 
 * @param {boolean} [firstOrderOnly=true] - Whether to filter based on the first order only.
 * @returns {Unit[]} An array of workers gathering the specified resource type.
 */
function getGatheringWorkers(units, type = undefined, firstOrderOnly = true) {
  // Cache the pending orders to avoid fetching them multiple times for each worker
  const pendingOrdersCache = new Map();

  const gatheringWorkers = units.getWorkers()
    .filter(worker => {
      if (!pendingOrdersCache.has(worker.tag)) {
        pendingOrdersCache.set(worker.tag, getPendingOrders(worker));
      }
      const pendingOrders = pendingOrdersCache.get(worker.tag);

      return (
        worker.isGathering(type) ||
        pendingOrders.some(/** @type {function(SC2APIProtocol.UnitOrder): boolean} */ (order) =>
          order.abilityId !== undefined && gatheringAbilities.includes(order.abilityId)
        )
      );
    });

  if (firstOrderOnly) {
    return gatheringWorkers.filter(worker => {
      const { orders } = worker;
      if (orders === undefined) return false;

      const pendingOrders = pendingOrdersCache.get(worker.tag);
      const gatheringOrders = [...orders, ...pendingOrders].filter(/** @type {function(SC2APIProtocol.UnitOrder): boolean} */ (order) =>
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
function assignWorkerToField(worker, completedBases, map, units, resources) {
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

  // Filter out mineral fields in the fog of war using the map's visibility function
  const mineralFields = units.getMineralFields().filter(mineralField => {
    // Check if the mineral field is visible and has a valid position
    if (!mineralField.pos || !map.isVisible(mineralField.pos)) return false;
    const distance = getDistance(basePos, mineralField.pos);
    return distance !== undefined && distance < 14;
  });

  const assignedMineralField = worker.labels.get('mineralField');
  if (assignedMineralField && assignedMineralField.tag !== undefined) {
    let currentMineralField = units.getByTag(assignedMineralField.tag);

    // Check if the current mineral field is visible and has a valid position
    if (currentMineralField && currentMineralField.pos && map.isVisible(currentMineralField.pos)) {
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
      // Mineral field is in fog of war or no longer exists
      worker.labels.delete('mineralField');
    }
  } else {
    // No previously assigned mineral field or the field is no longer valid
    const neediestMineralField = getNeediestMineralField(units, mineralFields);
    if (neediestMineralField) {
      const unitCommands = gather(resources, worker, neediestMineralField, false);
      collectedActions.push(...unitCommands);
      worker.labels.set('mineralField', neediestMineralField);
      neediestMineralField.labels.set('workerCount', neediestMineralField.labels.get('workerCount') + 1);
    }
  }

  // If no visible mineral fields are available, add fallback logic
  if (!mineralFields.length) {
    // You can add idle, scout, or fallback logic here if no mineral fields are visible
    collectedActions.push({ /* idle or scouting action */ });
  }

  return collectedActions;
}

/**
 * Checks if a townhall needs more workers.
 * Includes under construction townhalls if fields are saturated.
 * @param {World} world - The game world context.
 * @param {Unit} townhall - The townhall to check.
 * @param {number} averageGatheringTime - The average time it takes for a worker to gather resources.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {boolean} Whether the townhall needs more workers.
 */
function isTownhallNeedy(world, townhall, averageGatheringTime, units) {
  const { assignedHarvesters, idealHarvesters, buildProgress } = townhall;
  const nearbyEnemies = findNearbyEnemies(units, townhall);
  const isUnderConstruction = buildProgress !== undefined && buildProgress < 1;

  // Retrieve the build time from the unit's type data
  const unitTypeData = townhall.data();
  const buildTime = unitTypeData ? unitTypeData.buildTime : undefined;
  const remainingBuildTime = (buildTime !== undefined && buildProgress !== undefined)
    ? (buildTime * (1 - buildProgress)) / 22.4  // Convert from frames to seconds
    : 0;

  // Check if nearby mineral fields are saturated for under-construction townhalls
  const nearbyFieldsSaturated = isUnderConstruction && areMineralFieldsSaturated(units, townhall);

  let shouldReassign = false;
  if (isUnderConstruction && !nearbyFieldsSaturated) {
    const potentialWorkers = getGatheringWorkers(units).filter(worker => {
      if (worker.pos) { // Check if worker.pos is defined
        const [mineralField] = units.getClosest(worker.pos, units.getMineralFields());
        if (mineralField) {
          const estimatedTime = estimateGatherAndReturnTime(worker, mineralField, averageGatheringTime);
          return estimatedTime > remainingBuildTime;
        }
      }
      return false;
    });

    shouldReassign = potentialWorkers.length > 0;
  }

  const needsMoreWorkers = assignedHarvesters !== undefined && idealHarvesters !== undefined && assignedHarvesters < idealHarvesters;

  return (
    (shouldReassign && isUnderConstruction) ||
    (needsMoreWorkers) &&
    nearbyEnemies.length === 0 &&
    !isTownhallInDanger(world, townhall, nearbyEnemies)
  );
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
  return (isNotConstructing && !unit.isAttacking() && !isPendingConstructing(unit)) || probeAndMoving;
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
  assignWorkersToMinerals,
  balanceWorkers,
  distributeWorkersAcrossBases,
  gather,
  getGatheringWorkers,
  getWithLabelAvailable,
  reassignIdleWorkers,
};
