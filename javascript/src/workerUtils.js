//@ts-check
"use strict"

// External library imports
const { UnitType, Ability } = require("@node-sc2/core/constants");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const groupTypes = require("@node-sc2/core/constants/groups");
// Internal module imports from other utility files
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { getById } = require("./gameUtils");
const { getDistance } = require("./geometryUtils");
const { isMoving, dbscanWithUnits, getBuildTimeLeft, getUnitsFromClustering, getClosestPathWithGasGeysers } = require("./sharedUtils");
const { unitTypeTrainingAbilities } = require("./unitConfig");
const { setPendingOrders } = require("./unitOrders");
const { getUnitsTrainingTargetUnitType } = require("./unitWorkerService");
const { createUnitCommand, getDistanceByPath } = require("./utils");
const { getWorkerSourceByPath } = require("./utils/gameLogic/coreUtils");
const { getPendingOrders } = require("./utils/gameLogic/commonGameUtils");
const { getNeediestMineralField } = require("./utils/gameLogic/mineralFieldUtils");
const { stopUnitFromMovingToPosition } = require("./workerHelpers");

/** 
 * Flag to track if workers training is tended to.
 * @type {boolean}
 */
let workersTrainingTendedTo = false;

/**
 * Sets rally points for workers and stops a unit from moving to a position.
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleRallyBase = (world, unit, position) => {
  let actions = [];
  actions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));
  actions.push(...stopUnitFromMovingToPosition(unit, position));
  return actions;
};

/**
 * Checks if workers training has been tended to.
 * @returns {boolean}
 */
function isWorkersTrainingTendedTo() {
  return workersTrainingTendedTo;
}

/**
 * @param {Unit} unit
 * @param {boolean} pending
 * @returns {boolean}
 **/
function isConstructing(unit, pending = false) {
  /** @type {SC2APIProtocol.UnitOrder[]} */
  let pendingOrders = [];
  if (pending) {
    pendingOrders = getPendingOrders(unit);
  }
  return unit.isConstructing() || pendingOrders.some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
}

/**
 * Function to gather builder candidates
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @param {Point2D} position
 * @returns {Unit[]}
 */
function gatherBuilderCandidates(units, builderCandidates, position) {
  /** @type {Unit[]} */
  const movingOrConstructingNonDrones = [];
  builderCandidates.push(...units.getWorkers().filter(worker => {
    const { orders } = worker; if (orders === undefined) return false;
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const gatheringAndNotMining = worker.isGathering() && !isMining(units, worker);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === UnitType.PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === UnitType.SCV;
    if (isConstructingOrMovingProbe || isConstructingSCV) movingOrConstructingNonDrones.push(worker);
    const available = (
      worker.noQueue ||
      gatheringAndNotMining ||
      orders.findIndex(order => order.targetWorldSpacePos && (getDistance(order.targetWorldSpacePos, position) < 1)) > -1
    );
    return isNotDuplicate && available;
  }));
  return builderCandidates;
}

/**
 * @param {UnitResource} units
 * @param {Unit} worker
 * @returns {boolean}
 **/
function isMining(units, worker) {
  const { pos, unitType } = worker; if (pos === undefined || unitType === undefined) { return false; }
  const orderTargetPosition = getOrderTargetPosition(units, worker); if (orderTargetPosition === undefined) { return false; }
  const distanceToResource = getDistance(pos, orderTargetPosition);
  let minimumDistanceToResource = 0;
  if (worker.isGathering('vespene')) {
    minimumDistanceToResource = 2.28;
  } else if (worker.isGathering('minerals')) {
    minimumDistanceToResource = unitType === UnitType.MULE ? 1.92 : 1.62;
  }
  return distanceToResource < minimumDistanceToResource;
}

/**
 * @param {UnitResource} units
 * @param {Unit} unit
 * @returns {Point2D|undefined}
 */
function getOrderTargetPosition(units, unit) {
  if (unit.orders && unit.orders.length > 0) {
    const order = unit.orders[0];
    if (order.targetWorldSpacePos) {
      return order.targetWorldSpacePos;
    } else if (order.targetUnitTag) {
      const targetUnit = units.getByTag(order.targetUnitTag);
      if (targetUnit) {
        return targetUnit.pos;
      }
    }
  }
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @returns {Unit[]}
 */
function filterMovingOrConstructingNonDrones(units, builderCandidates) {
  const { PROBE, SCV } = UnitType;

  return units.getWorkers().filter(worker => {
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === SCV;

    return (isConstructingOrMovingProbe || isConstructingSCV) && isNotDuplicate;
  });
}

/**
 * Filter out builder candidates who are also moving or constructing drones.
 * 
 * @param {Unit[]} builderCandidates - The array of builder candidates.
 * @param {Unit[]} movingOrConstructingNonDrones - The array of drones that are either moving or in construction.
 * @returns {Unit[]} - The filtered array of builder candidates.
 */
function filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones) {
  return builderCandidates.filter(builder => !movingOrConstructingNonDrones.some(movingOrConstructingNonDrone => movingOrConstructingNonDrone.tag === builder.tag));
}

/**
 * Get clusters of builder candidate positions
 * @param {Unit[]} builderCandidates 
 * @returns {{center: Point2D, units: Unit[]}[]}
 */
function getBuilderCandidateClusters(builderCandidates) {
  // Prepare data for dbscanWithUnits
  let pointsWithUnits = builderCandidates.reduce((/** @type {{point: Point2D, unit: Unit}[]} */accumulator, builder) => {
    const { pos } = builder;
    if (pos === undefined) return accumulator;
    accumulator.push({ point: pos, unit: builder });
    return accumulator;
  }, []);

  // Apply DBSCAN to get clusters
  let builderCandidateClusters = dbscanWithUnits(pointsWithUnits, 9);

  return builderCandidateClusters;
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @returns {boolean}
 */
function isIdleOrAlmostIdle(data, unit) {
  // if the unit is idle, no need to check anything else
  if (unit.orders && unit.orders.length === 0 && unit.buildProgress && unit.buildProgress === 1) {
    return true;
  }

  // now check if it is almost idle
  const { abilityId = null, progress = null } = (unit.orders && unit.orders.length > 0) ? unit.orders[0] : {};
  let unitTypeTraining;
  if (abilityId !== null) {
    unitTypeTraining = unitTypeTrainingAbilities.get(abilityId);
  }
  const unitTypeData = unitTypeTraining && data.getUnitTypeData(unitTypeTraining);
  const { buildTime } = unitTypeData || {};
  let buildTimeLeft;
  if (buildTime !== undefined && progress !== null) {
    buildTimeLeft = getBuildTimeLeft(unit, buildTime, progress);
  }
  const isAlmostIdle = buildTimeLeft !== undefined && buildTimeLeft <= 8 && getPendingOrders(unit).length === 0;
  return isAlmostIdle;
}



/**
 * Rallies a worker to a specified target position.
 * @param {World} world 
 * @param {Point2D} position
 * @param {(units: Unit[]) => Unit[]} getUnitsFromClustering - Injected dependency from unitManagement.js
 * @param {boolean} mineralTarget
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const rallyWorkerToTarget = (world, position, getUnitsFromClustering, mineralTarget = false) => {
  const { rallyWorkersAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { DRONE, EGG } = UnitType;

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  const workerSourceByPath = getWorkerSourceByPath(world, position, getUnitsFromClustering);
  if (!workerSourceByPath) return collectedActions;

  const { orders, pos } = workerSourceByPath;
  if (pos === undefined) return collectedActions;

  if (getPendingOrders(workerSourceByPath).some(order => order.abilityId && order.abilityId === Ability.SMART)) return collectedActions;

  let rallyAbility = null;
  if (workerSourceByPath.unitType === EGG) {
    rallyAbility = orders?.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? Ability.RALLY_BUILDING : null;
  } else {
    rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
  }

  if (!rallyAbility) return collectedActions;

  const unitCommand = createUnitCommand(Ability.SMART, [workerSourceByPath]);
  if (mineralTarget) {
    const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(pos, mineralField.pos) < 14);
    const neediestMineralField = getNeediestMineralField(units, mineralFields);
    if (neediestMineralField === undefined) return collectedActions;
    unitCommand.targetUnitTag = neediestMineralField.tag;
  } else {
    unitCommand.targetWorldSpacePos = position;
  }

  collectedActions.push(unitCommand);
  setPendingOrders(workerSourceByPath, unitCommand);

  return collectedActions;
};

/**
 * Sets the workersTrainingTendedTo flag.
 * @param {boolean} status - The status to set.
 */
function setWorkersTrainingTendedTo(status) {
  workersTrainingTendedTo = status;
}

/**
 * Determines if there are fewer workers than needed for optimal resource harvesting.
 * @param {World} world - The current game world context.
 * @returns {boolean} - True if more workers are needed, false otherwise.
 */
function shortOnWorkers(world) {
  const { gasMineTypes, townhallTypes } = groupTypes;
  const { agent, resources } = world;
  const { map, units } = resources.get();
  let idealHarvesters = 0
  let assignedHarvesters = 0
  const mineralCollectors = [...units.getBases(), ...getById(resources, gasMineTypes)];
  mineralCollectors.forEach(mineralCollector => {
    const { buildProgress, assignedHarvesters: assigned, idealHarvesters: ideal, unitType } = mineralCollector;
    if (buildProgress === undefined || assigned === undefined || ideal === undefined || unitType === undefined) return;
    if (buildProgress === 1) {
      assignedHarvesters += assigned;
      idealHarvesters += ideal;
    } else {
      if (townhallTypes.includes(unitType)) {
        const { pos: townhallPos } = mineralCollector; if (townhallPos === undefined) return false;
        if (map.getExpansions().some(expansion => getDistance(expansion.townhallPosition, townhallPos) < 1)) {
          let mineralFields = [];
          if (!mineralCollector.labels.has('mineralFields')) {
            mineralFields = units.getMineralFields().filter(mineralField => {
              const { pos } = mineralField; if (pos === undefined) return false;
              if (getDistance(pos, townhallPos) < 16) {
                const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, townhallPos)
                const { pathablePosition, pathableTargetPosition } = closestPathablePositionBetweenPositions;
                const distanceByPath = getDistanceByPath(resources, pathablePosition, pathableTargetPosition);
                return distanceByPath <= 16;
              } else {
                return false;
              }
            });
            mineralCollector.labels.set('mineralFields', mineralFields);
          }
          mineralFields = mineralCollector.labels.get('mineralFields');
          idealHarvesters += mineralFields.length * 2 * buildProgress;
        }
      } else {
        idealHarvesters += 3 * buildProgress;
      }
    }
  });


  if (agent.race === undefined) {
    console.error("Agent race is undefined.");
    return false; // Or handle this situation as appropriate
  }

  // count workers that are training
  const unitsTrainingTargetUnitType = getUnitsTrainingTargetUnitType(world, WorkerRace[agent.race]);
  const shortOnWorkers = idealHarvesters > (assignedHarvesters + unitsTrainingTargetUnitType.length);

  workersTrainingTendedTo = !shortOnWorkers;
  return shortOnWorkers;
}

module.exports = {
  gatherBuilderCandidates,
  isConstructing,
  isMining,
  isWorkersTrainingTendedTo,
  filterMovingOrConstructingNonDrones,
  filterBuilderCandidates,
  getBuilderCandidateClusters,
  isIdleOrAlmostIdle,
  handleRallyBase,
  getOrderTargetPosition,
  rallyWorkerToTarget,
  setWorkersTrainingTendedTo,
  shortOnWorkers,
};
