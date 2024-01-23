//@ts-check
"use strict"

// pathfinding.js

// External library imports

// Internal module imports
const { getDistance } = require("./geometryUtils"); // combined utils from geometryUtils and utils
const { getGasGeysers } = require("./mapUtils");
const { getPathablePositions } = require("./pathUtils");
const { getStructureCells } = require("./placementPathfindingUtils");
const { getDistanceByPath } = require("./utils");
const { getClosestPathablePositionsBetweenPositions } = require("./utils/gameLogic/sharedPathfindingUtils");

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
    const pathablePosData = getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const distanceByPath = getDistanceByPath(resources, pathablePosData.pathablePosition, pathablePosData.pathableTargetPosition) || Number.MAX_VALUE;

    const isWithin16 = distanceToUnit <= 16 && distanceByPath <= 16;
    return {
      within16: isWithin16 ? [...acc.within16, unit] : acc.within16,
      outside16: isWithin16 ? acc.outside16 : [...acc.outside16, unit]
    };
  }, { within16: [], outside16: [] });

  let closestUnits = splitUnits.within16.sort((a, b) => {
    const { pos } = a; if (pos === undefined) return 1;
    const { pos: bPos } = b; if (bPos === undefined) return -1;
    const aData = getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const bData = getClosestPathablePositionsBetweenPositions(resources, bPos, position, gasGeysers);
    return getDistanceByPath(resources, aData.pathablePosition, aData.pathableTargetPosition) - getDistanceByPath(resources, bData.pathablePosition, bData.pathableTargetPosition);
  });

  if (n === 1 && closestUnits.length > 0) return closestUnits;

  const unitsByDistance = [...closestUnits, ...splitUnits.outside16].reduce((/** @type {{unit: Unit, distance: number}[]} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    const expansionWithin16 = map.getExpansions().find(expansion => {
      const { centroid: expansionPos } = expansion;
      if (expansionPos === undefined) return false;

      const pathablePosData = getClosestPathablePositionsBetweenPositions(resources, expansionPos, pos, gasGeysers);
      if (!pathablePosData) return false;

      // Use fallback values if getDistance or pathablePosData.distance returns undefined
      const distanceToExpansion = getDistance(expansionPos, pos) || Number.MAX_VALUE;
      const distanceByPath = pathablePosData.distance || Number.MAX_VALUE;

      return distanceToExpansion <= 16 && distanceByPath <= 16;
    });

    if (!expansionWithin16 || !expansionWithin16.centroid) return acc;
    const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, expansionWithin16.centroid, position, gasGeysers);
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
  return points.map(point => ({ point, distance: getDistanceByPath(resources, position, point) }))
    .sort((a, b) => a.distance - b.distance)
    .map(pointObject => pointObject.point)
    .slice(0, n);
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

/**
 * @param {ResourceManager} resources
 * @param {Point2D} unitPosition
 * @param {Point2D} position
 * @returns {Point2D}
 */
function getClosestUnitPositionByPath(resources, unitPosition, position) {
  const { map } = resources.get();
  const pathablePositions = getPathablePositions(map, unitPosition);
  const [closestPositionByPath] = getClosestPositionByPath(resources, position, pathablePositions);
  return closestPositionByPath;
}

module.exports = {
  getClosestUnitByPath,
  getClosestBuilderCandidate,
  getClosestPositionByPath,
  getClosestUnitPositionByPath
};