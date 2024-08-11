/**
 * Module responsible for managing gathering-related operations.
 */

const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

const config = require("../../../config/config");

const GATHERING_LABEL = 'gatheringStartTime';

/**
 * Calculates the gathering time for a worker if it has finished gathering.
 * @param {Unit} worker - The worker unit.
 * @param {World} world - The game world context to retrieve the current game time.
 * @returns {number | null} The time taken to gather and return, or null if not finished.
 */
function calculateGatheringTime(worker, world) {
  if (worker.isReturning('minerals') || worker.isReturning('vespene')) {
    const startTime = worker.getLabel(GATHERING_LABEL);
    if (startTime) {
      const frame = world.resources.get().frame;
      const currentTime = frame.timeInSeconds(); // Game time in seconds
      const gatherTime = currentTime - startTime;
      worker.removeLabel(GATHERING_LABEL);
      return gatherTime;
    }
  }
  return null;
}

/**
 * Starts tracking the gathering time of workers.
 * @param {Unit} worker - The worker unit.
 * @param {World} world - The game world context to retrieve the current game time.
 */
function startTrackingWorkerGathering(worker, world) {
  const frame = world.resources.get().frame;
  const currentTime = frame.timeInSeconds(); // Game time in seconds

  if (worker.orders && worker.orders.some(order => order.abilityId !== undefined && gatheringAbilities.includes(order.abilityId))) {
    if (!worker.hasLabel(GATHERING_LABEL)) {
      worker.addLabel(GATHERING_LABEL, currentTime);
    }
  }
}

/**
 * Track and calculate average gathering time.
 * @param {Array<Unit>} workers - The list of worker units.
 * @param {World} world - The current game world state.
 */
function updateAverageGatheringTime(workers, world) {
  let totalGatheringTime = 0;
  let gatherCount = 0;
  let sumOfSquares = 0;

  workers.forEach(worker => {
    startTrackingWorkerGathering(worker, world);
    const gatherTime = calculateGatheringTime(worker, world);
    if (gatherTime !== null) {
      gatherCount++;
      totalGatheringTime += gatherTime;
      sumOfSquares += gatherTime * gatherTime;
    }
  });

  if (gatherCount > 0) {
    const mean = totalGatheringTime / gatherCount;
    const variance = (sumOfSquares / gatherCount) - (mean * mean);
    const stdDev = Math.sqrt(variance);

    let adjustedTotal = 0;
    let adjustedCount = 0;

    workers.forEach(worker => {
      const gatherTime = calculateGatheringTime(worker, world);
      if (gatherTime !== null && Math.abs(gatherTime - mean) <= 2 * stdDev) {
        adjustedTotal += gatherTime;
        adjustedCount++;
      }
    });

    if (adjustedCount > 0) {
      const calculatedAverage = adjustedTotal / adjustedCount;
      const smoothingFactor = stdDev / (mean + stdDev);

      const currentAverage = config.getAverageGatheringTime();
      const newAverage = (currentAverage || calculatedAverage) * (1 - smoothingFactor) + calculatedAverage * smoothingFactor;

      config.setAverageGatheringTime(newAverage);
    }
  }
}

// Exporting the function to be used in other modules
module.exports = {
  calculateGatheringTime,
  startTrackingWorkerGathering,
  updateAverageGatheringTime,
};
