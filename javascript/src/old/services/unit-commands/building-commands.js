//@ts-check
"use strict"

const { pathFindingService } = require("../pathfinding");
const groupTypes = require("@node-sc2/core/constants/groups");

// unit-commands/building-commands.js

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
