//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { getWithLabelAvailable } = require("./workerAssignment");
const { getPendingOrders, isMoving, dbscanWithUnits, getBuildTimeLeft } = require("./sharedUtils");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { getDistance } = require("./geometryUtils");
const { unitTypeTrainingAbilities } = require("./unitConfig");

/**
 * Sets rally points for workers and stops a unit from moving to a position.
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleRallyBase = (world, unit, position) => {
  let actions = [];
  actions.push(...worldService.rallyWorkerToTarget(world, position));
  actions.push(...stopUnitFromMovingToPosition(unit, position));
  return actions;
};

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

module.exports = {
  getBuilders,
  gatherBuilderCandidates,
  isConstructing,
  filterMovingOrConstructingNonDrones,
  filterBuilderCandidates,
  getBuilderCandidateClusters,
  isIdleOrAlmostIdle,
  handleRallyBase,
};
