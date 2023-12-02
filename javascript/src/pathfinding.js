//@ts-check
"use strict"

// pathfinding.js

// External library imports
const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");

// Internal module imports
const { getDistance } = require("./geometryUtils"); // combined utils from geometryUtils and utils
const { getGasGeysers } = require("./mapUtils");
const { getStructureCells } = require("./placementPathfindingUtils");
const { unitTypeTrainingAbilities } = require("./unitConfig");
const { getTimeInSeconds, getDistanceByPath } = require("./utils");



/**
 * Get the closest worker source to a given position.
 * @param {World} world
 * @param {Point2D} position
 * @param {(units: Unit[]) => Unit[]} getUnitsFromClustering - Function to cluster units, injected dependency.
 * @returns {Unit}
 */
const getWorkerSourceByPath = (world, position, getUnitsFromClustering) => {
  const { agent, resources } = world;
  const { units } = resources.get();
  const { EGG } = UnitType;

  let unitList;
  if (agent.race === Race.ZERG) {
    unitList = getUnitsFromClustering(units.getById(EGG));
  } else {
    unitList = getUnitsFromClustering(units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1));
  }

  const [closestUnitByPath] = getClosestUnitByPath(resources, position, unitList);
  return closestUnitByPath;
}

/**
 *
 * @param {ResourceManager} resources
 * @param {Point2D|SC2APIProtocol.Point} position
 * @param {Unit[]} units
 * @param {Unit[]} gasGeysers
 * @param {number} n
 * @returns {Unit[]}
 */
function getClosestUnitByPath(resources, position, units, gasGeysers = [], n = 1) {
  const { map } = resources.get();

  const splitUnits = units.reduce((/** @type {{within16: Unit[], outside16: Unit[]}} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    // Use a fallback value if getDistance returns undefined
    const distanceToUnit = getDistance(pos, position) || Number.MAX_VALUE;
    const pathablePosData = this.getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const distanceByPath = this.getDistanceByPath(resources, pathablePosData.pathablePosition, pathablePosData.pathableTargetPosition) || Number.MAX_VALUE;

    const isWithin16 = distanceToUnit <= 16 && distanceByPath <= 16;
    return {
      within16: isWithin16 ? [...acc.within16, unit] : acc.within16,
      outside16: isWithin16 ? acc.outside16 : [...acc.outside16, unit]
    };
  }, { within16: [], outside16: [] });

  let closestUnits = splitUnits.within16.sort((a, b) => {
    const { pos } = a; if (pos === undefined) return 1;
    const { pos: bPos } = b; if (bPos === undefined) return -1;
    const aData = this.getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const bData = this.getClosestPathablePositionsBetweenPositions(resources, bPos, position, gasGeysers);
    return this.getDistanceByPath(resources, aData.pathablePosition, aData.pathableTargetPosition) - this.getDistanceByPath(resources, bData.pathablePosition, bData.pathableTargetPosition);
  });

  if (n === 1 && closestUnits.length > 0) return closestUnits;

  const unitsByDistance = [...closestUnits, ...splitUnits.outside16].reduce((/** @type {{unit: Unit, distance: number}[]} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    const expansionWithin16 = map.getExpansions().find(expansion => {
      const { centroid: expansionPos } = expansion;
      if (expansionPos === undefined) return false;

      const pathablePosData = this.getClosestPathablePositionsBetweenPositions(resources, expansionPos, pos, gasGeysers);
      if (!pathablePosData) return false;

      // Use fallback values if getDistance or pathablePosData.distance returns undefined
      const distanceToExpansion = getDistance(expansionPos, pos) || Number.MAX_VALUE;
      const distanceByPath = pathablePosData.distance || Number.MAX_VALUE;

      return distanceToExpansion <= 16 && distanceByPath <= 16;
    });

    if (!expansionWithin16 || !expansionWithin16.centroid) return acc;
    const closestPathablePositionBetweenPositions = this.getClosestPathablePositionsBetweenPositions(resources, expansionWithin16.centroid, position, gasGeysers);
    if (!closestPathablePositionBetweenPositions) return acc;

    // Add only if closestPathablePositionBetweenPositions.distance is defined
    if (typeof closestPathablePositionBetweenPositions.distance === 'number') {
      acc.push({ unit, distance: closestPathablePositionBetweenPositions.distance });
    }
    return acc;
  }, []).sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.distance - b.distance;
  });

  return unitsByDistance.slice(0, n).map(u => u.unit);
}

/**
 * 
 * @param {ResourceManager} resources 
 * @param {Point2D} position 
 * @param {Point2D[]} points
 * @param {number} n
 * @returns {Point2D[]}
 */
function getClosestPositionByPath(resources, position, points, n = 1) {
  return points.map(point => ({ point, distance: this.getDistanceByPath(resources, position, point) }))
    .sort((a, b) => a.distance - b.distance)
    .map(pointObject => pointObject.point)
    .slice(0, n);
}

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
    const unitType = unitTypeTrainingAbilities.get(abilityId); if (unitType === undefined) return closestWorker;
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return closestWorker;

    // get closest unit type to worker position if within unit type radius
    const closestUnitType = units.getClosest(pos, units.getById(unitType)).filter(unit => unit.pos && getDistance(unit.pos, pos) < 3)[0];

    if (closestUnitType) {
      const { buildProgress } = closestUnitType; if (buildProgress === undefined) return closestWorker;
      const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
      const distanceToPositionByPath = getDistanceByPath(resources, pos, position);
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

    const distance = getDistanceByPath(resources, pos, position);

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

module.exports = {
  getClosestUnitByPath,
  calculateClosestConstructingWorker,
  getClosestBuilderCandidate,
  getClosestPositionByPath,
  getWorkerSourceByPath
};