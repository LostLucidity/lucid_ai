//@ts-check
"use strict"

const { pathFindingService } = require("../pathfinding");
const groupTypes = require("@node-sc2/core/constants/groups");

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
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number} | undefined}
 */
const getBuilder = (world, position) => {
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

// Export any other shared functionality related to building commands
module.exports = {
  getBuilder,
};
