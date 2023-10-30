//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const unitService = require("../../../services/unit-service");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");
const { getDistance, dbscanWithUnits, getStructureCells } = require("../../../services/position-service");
const { getGasGeysers } = require("../unit-retrieval");
const { pathFindingService } = require("../pathfinding");
const { getClosestUnitPositionByPath } = require("../../../services/resource-manager-service");
const dataService = require("../../../services/data-service");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getClosestPathWithGasGeysers } = require("../utility-service");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const groupTypes = require("@node-sc2/core/constants/groups");
const { getTimeInSeconds } = require("../../../services/frames-service");

// unit-commands/building-commands.js

/**
 * Calculate the closest constructing worker and the time to reach a specific position
 * @param {World} world - The resources object to access game state
 * @param {Unit[]} constructingWorkers - The array of workers currently in constructing state
 * @param {Point2D} position - The position to calculate the distance to
 * @returns {{unit: Unit, timeToPosition: number} | undefined} - Closest constructing worker and time to reach the position or undefined
 */
function calculateClosestConstructingWorker(world, constructingWorkers, position) {
  const { data, resources } = world;
  const { units } = resources.get();

  return constructingWorkers.reduce((/** @type {{unit: Unit, timeToPosition: number} | undefined} */closestWorker, worker) => {
    const { orders, pos } = worker; if (orders === undefined || pos === undefined) return closestWorker;
    // get unit type of building in construction
    const constructingOrder = orders.find(order => order.abilityId && groupTypes.constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return closestWorker;
    const { abilityId } = constructingOrder; if (abilityId === undefined) return closestWorker;
    const unitType = dataService.unitTypeTrainingAbilities.get(abilityId); if (unitType === undefined) return closestWorker;
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return closestWorker;

    // get closest unit type to worker position if within unit type radius
    const closestUnitType = units.getClosest(pos, units.getById(unitType)).filter(unit => unit.pos && getDistance(unit.pos, pos) < 3)[0];

    if (closestUnitType) {
      const { buildProgress } = closestUnitType; if (buildProgress === undefined) return closestWorker;
      const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
      const distanceToPositionByPath = pathFindingService.getDistanceByPath(resources, pos, position);
      const { movementSpeed } = worker.data(); if (movementSpeed === undefined) return closestWorker;
      const movementSpeedPerSecond = movementSpeed * 1.4;
      const timeToPosition = buildTimeLeft + (distanceToPositionByPath / movementSpeedPerSecond);

      // If this is the first worker or if it's closer than the current closest worker, update closestWorker
      if (!closestWorker || timeToPosition < closestWorker.timeToPosition) {
        return { unit: worker, timeToPosition };
      }
    }

    return closestWorker;
  }, undefined);
}

/**
 * @param {World} world
 * @param {Unit[]} movingOrConstructingNonDrones 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number}[]}
 */
function calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position) {
  const { getMovementSpeed, getPendingOrders } = unitService;
  const { resources } = world;
  const { map, units } = resources.get();
  const { SCV, SUPPLYDEPOT } = UnitType;

  return movingOrConstructingNonDrones.reduce((/** @type {{unit: Unit, timeToPosition: number}[]} */acc, movingOrConstructingNonDrone) => {
    const { orders, pos, unitType } = movingOrConstructingNonDrone;
    if (orders === undefined || pos === undefined || unitType === undefined) return acc;

    orders.push(...getPendingOrders(movingOrConstructingNonDrone));
    const { abilityId, targetWorldSpacePos, targetUnitTag } = orders[0];
    if (abilityId === undefined || (targetWorldSpacePos === undefined && targetUnitTag === undefined)) return acc;

    const movingPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined;
    const movementSpeed = getMovementSpeed(map, movingOrConstructingNonDrone);
    if (movingPosition === undefined || movementSpeed === undefined) return acc;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const isSCV = unitType === SCV;
    const constructingStructure = isSCV ? getStructureAtPosition(units, movingPosition) : undefined;
    constructingStructure && setPathableGrids(map, constructingStructure, true);

    const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
    const movingProbeTimeToMovePosition = pathFindingService.getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeedPerSecond;

    constructingStructure && setPathableGrids(map, constructingStructure, false);

    let buildTimeLeft = 0;
    let supplyDepotCells = [];
    if (isSCV) {
      buildTimeLeft = getContructionTimeLeft(world, movingOrConstructingNonDrone);
      const isConstructingSupplyDepot = dataService.unitTypeTrainingAbilities.get(abilityId) === SUPPLYDEPOT;
      if (isConstructingSupplyDepot) {
        const [supplyDepot] = units.getClosest(movingPosition, units.getStructures().filter(structure => structure.unitType === SUPPLYDEPOT));
        if (supplyDepot !== undefined) {
          const { pos, unitType } = supplyDepot; if (pos === undefined || unitType === undefined) return acc;
          const footprint = getFootprint(unitType); if (footprint === undefined) return acc;
          supplyDepotCells = cellsInFootprint(pos, footprint);
          supplyDepotCells.forEach(cell => map.setPathable(cell, true));
        }
      }
    }

    const pathablePremovingPosition = getClosestUnitPositionByPath(resources, position, pathableMovingPosition);
    const targetTimeToPremovePosition = pathFindingService.getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeedPerSecond;
    supplyDepotCells.forEach(cell => map.setPathable(cell, false));

    const timeToPosition = movingProbeTimeToMovePosition + buildTimeLeft + targetTimeToPremovePosition;

    acc.push({
      unit: movingOrConstructingNonDrone,
      timeToPosition: timeToPosition
    });

    return acc;
  }, []);
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
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @returns {Unit[]}
 */
function filterMovingOrConstructingNonDrones(units, builderCandidates) {
  const { isConstructing, isMoving } = unitService;
  const { PROBE, SCV } = UnitType;

  return units.getWorkers().filter(worker => {
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === SCV;

    return (isConstructingOrMovingProbe || isConstructingSCV) && isNotDuplicate;
  });
}

/**
 * Function to gather builder candidates
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @param {Point2D} position
 * @returns {Unit[]}
 */
function gatherBuilderCandidates(units, builderCandidates, position) {
  const { isConstructing, isMoving } = unitService;
  /** @type {Unit[]} */
  const movingOrConstructingNonDrones = [];
  builderCandidates.push(...units.getWorkers().filter(worker => {
    const { orders } = worker; if (orders === undefined) return false;
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const gatheringAndNotMining = worker.isGathering() && !unitResourceService.isMining(units, worker);
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
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {{unit: Unit, timeToPosition: number}[]} movingOrConstructingNonDronesTimeToPosition
 * @param {Unit | undefined} closestBuilder
 * @returns {Array<{unit: Unit, timeToPosition: number}>}
 */
const gatherCandidateWorkersTimeToPosition = (resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilder) => {
  const { map } = resources.get();
  let candidateWorkersTimeToPosition = [];

  const [movingOrConstructingNonDrone] = movingOrConstructingNonDronesTimeToPosition.sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.timeToPosition - b.timeToPosition;
  });

  if (movingOrConstructingNonDrone !== undefined) {
    candidateWorkersTimeToPosition.push(movingOrConstructingNonDrone);
  }

  if (closestBuilder !== undefined) {
    const { pos } = closestBuilder;
    if (pos === undefined) return candidateWorkersTimeToPosition;

    const movementSpeed = unitService.getMovementSpeed(map, closestBuilder);
    if (movementSpeed === undefined) return candidateWorkersTimeToPosition;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const closestPathablePositionsBetweenPositions = getClosestPathWithGasGeysers(resources, pos, position);
    const closestBuilderWithDistance = {
      unit: closestBuilder,
      timeToPosition: closestPathablePositionsBetweenPositions.distance / movementSpeedPerSecond
    };

    candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
  }

  return candidateWorkersTimeToPosition;
};

/**
 * @param {World} world 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number} | undefined}
 */
const getBuilder = (world, position) => {
  const { getBuilders } = unitResourceService;
  const { resources } = world;
  const { units } = resources.get();

  // Define builderCandidates before using it
  let builderCandidates = getBuilders(units);

  builderCandidates = gatherBuilderCandidates(units, builderCandidates, position);
  const movingOrConstructingNonDrones = filterMovingOrConstructingNonDrones(units, builderCandidates);
  builderCandidates = filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones);

  const builderCandidateClusters = getBuilderCandidateClusters(builderCandidates);

  let closestBuilderCandidate = getClosestBuilderCandidate(resources, builderCandidateClusters, position);
  const movingOrConstructingNonDronesTimeToPosition = calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position);

  const candidateWorkersTimeToPosition = gatherCandidateWorkersTimeToPosition(resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilderCandidate);

  const constructingWorkers = units.getConstructingWorkers();
  const closestConstructingWorker = calculateClosestConstructingWorker(world, constructingWorkers, position);

  if (closestConstructingWorker !== undefined) {
    candidateWorkersTimeToPosition.push(closestConstructingWorker);
  }

  const [closestWorker] = candidateWorkersTimeToPosition.sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.timeToPosition - b.timeToPosition;
  });

  if (closestWorker === undefined) return;
  return closestWorker;
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
 * @param {ResourceManager} resources
 * @param {{center: Point2D, units: Unit[]}[]} builderCandidateClusters
 * @param {Point2D} position
 * @returns {Unit | undefined}
 */
function getClosestBuilderCandidate(resources, builderCandidateClusters, position) {
  const { map, units } = resources.get();
  let closestCluster;
  let shortestClusterDistance = Infinity;

  // Find the closest cluster to the position
  for (let cluster of builderCandidateClusters) {
    const distance = getDistance(cluster.center, position);
    if (distance < shortestClusterDistance) {
      shortestClusterDistance = distance;
      closestCluster = cluster;
    }
  }

  // If no clusters, return undefined
  if (!closestCluster) return undefined;

  let closestBuilderCandidate;
  let shortestCandidateDistance = Infinity;

  // Store the original state of each cell
  const originalCellStates = new Map();
  const gasGeysers = getGasGeysers(units).filter(geyser => geyser.pos && getDistance(geyser.pos, position) < 1);
  const structureAtPositionCells = getStructureCells(position, gasGeysers);
  [...structureAtPositionCells].forEach(cell => {
    originalCellStates.set(cell, map.isPathable(cell));
    map.setPathable(cell, true);
  });

  // Find the closest candidate within that cluster
  for (let builderCandidate of closestCluster.units) {
    const { pos } = builderCandidate;
    if (pos === undefined) continue;

    const distance = pathFindingService.getDistanceByPath(resources, pos, position);

    if (distance < shortestCandidateDistance) {
      shortestCandidateDistance = distance;
      closestBuilderCandidate = builderCandidate;
    }
  }

  // Restore each cell to its original state
  [...structureAtPositionCells].forEach(cell => {
    const originalState = originalCellStates.get(cell);
    map.setPathable(cell, originalState);
  });

  // Return the closest candidate, or undefined if none was found
  return closestBuilderCandidate;
}

/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getContructionTimeLeft(world, unit, inSeconds = true) {
  const { getBuildTimeLeft } = unitService;
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos, targetUnitTag } = constructingOrder; if (targetWorldSpacePos === undefined && targetUnitTag === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && dataService.unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  let targetPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined; if (targetPosition === undefined) return 0;
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && getDistance(unit.pos, targetPosition) < 1);
  const { buildTime } = data.getUnitTypeData(unitTypeBeingConstructed); if (buildTime === undefined) return 0;
  if (unitAtTargetPosition !== undefined) {
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
  } else {
    buildTimeLeft = buildTime;
  }
  if (inSeconds) {
    return getTimeInSeconds(buildTimeLeft);
  }
  return buildTimeLeft;
}

/**
 * @param {UnitResource} units
 * @param {Point2D} movingPosition
 * @returns {Unit | undefined}
 * @description Returns the structure at the given position.
 */
function getStructureAtPosition(units, movingPosition) {
  return units.getStructures().find(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    return getDistance(pos, movingPosition) < 1;
  });
}

/**
 * @param {MapResource} map
 * @param {Unit} structure
 * @param {boolean} isPathable
 * @returns {void}
 * @description Sets the pathable grid for a structure.
 */
function setPathableGrids(map, structure, isPathable) {
  const { pos, unitType } = structure; if (pos === undefined || unitType === undefined) return;
  const footprint = getFootprint(unitType); if (footprint === undefined) return;
  cellsInFootprint(createPoint2D(pos), footprint).forEach(cell => map.setPathable(cell, isPathable));
}

// Export any other shared functionality related to building commands
module.exports = {
  getBuilder,
};
