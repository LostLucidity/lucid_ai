"use strict";

const { isStepInProgress } = require('../../../data/buildOrders/buildOrderUtils');
const StrategyManager = require('../../features/strategy/strategyManager');
const { GameState } = require('../../state');
const buildOrderState = require('../../state/buildOrderState');

// Centralized configuration object
const config = {
  ADDITIONAL_BUFFER_PER_ACTION_SECONDS: 5,
  BASE_BUFFER_TIME_SECONDS: 15,
  MARGIN_OF_ERROR_SECONDS: 5,
};

const buildOrderCompletion = new Map();
const gameState = GameState.getInstance();

/**
 * Checks and updates the build order progress.
 * @param {World} world - The current game world state.
 * @param {import('../../core/globalTypes').BuildOrderStep[]} buildOrder - The build order to track and update.
 */
async function trackBuildOrderProgress(world, buildOrder) {
  const currentTimeInSeconds = world.resources.get().frame.timeInSeconds();
  const currentSupply = gameState.getFoodUsed();
  const strategyManager = StrategyManager.getInstance();

  let allStepsCompleted = true;

  buildOrder.forEach((order, index) => {
    const orderStatus = getOrderStatus(order);
    if (orderStatus.completed) return;

    const expectedTimeInSeconds = timeStringToSeconds(order.time);
    const timeDifference = currentTimeInSeconds - expectedTimeInSeconds;
    const supplyDifference = currentSupply - Number(order.supply);
    const timeStatus = getTimeStatus(timeDifference);

    const stepCompleted = processBuildOrderStep({
      order,
      index,
      currentTimeInSeconds,
      expectedTimeInSeconds,
      currentSupply,
      timeStatus,
      timeDifference,
      supplyDifference,
      orderStatus,
      world,
      strategyManager
    });

    if (!stepCompleted) {
      allStepsCompleted = false;
    }

    buildOrderCompletion.set(order, orderStatus);
  });

  buildOrderState.setBuildOrderCompleted(allStepsCompleted);
}

/**
 * Check if a step is delayed and log it if necessary.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {{completed: boolean, logged: boolean, prematureLogged: boolean}} orderStatus
 * @param {import('../../core/globalTypes').BuildOrderStep} order
 * @param {number} index
 * @param {string} timeStatus
 * @param {number} timeDifference
 * @param {number} supplyDifference
 * @param {number} currentSupply
 * @returns {boolean} True if the step is delayed, otherwise false
 */
function checkAndLogDelayedStep(currentTimeInSeconds, expectedTimeInSeconds, orderStatus, order, index, timeStatus, timeDifference, supplyDifference, currentSupply) {
  const isDelayed = currentTimeInSeconds >= expectedTimeInSeconds + config.BASE_BUFFER_TIME_SECONDS + config.ADDITIONAL_BUFFER_PER_ACTION_SECONDS && !orderStatus.logged;
  if (isDelayed) {
    logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, false, true, currentSupply);
    orderStatus.logged = true;
  }
  return isDelayed;
}

/**
 * Get the status of the order from the buildOrderCompletion map.
 * @param {import('../../core/globalTypes').BuildOrderStep} order
 * @returns {{completed: boolean, logged: boolean, prematureLogged: boolean}} The status of the order
 */
function getOrderStatus(order) {
  return buildOrderCompletion.get(order) || { completed: false, logged: false, prematureLogged: false };
}

/**
 * Get the time status based on the time difference.
 * @param {number} timeDifference
 * @returns {string} The time status (ahead/behind schedule).
 */
function getTimeStatus(timeDifference) {
  return timeDifference < 0 ? "ahead of schedule" : "behind schedule";
}

/**
 * Handle the step in progress and log its status.
 * @param {import('../../core/globalTypes').BuildOrderStep} order
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {string} timeStatus
 * @param {number} timeDifference
 * @param {number} supplyDifference
 * @param {number} currentSupply
 * @param {{completed: boolean, logged: boolean, prematureLogged: boolean}} orderStatus
 */
function handleStepInProgress(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, currentSupply, orderStatus) {
  const shouldCompleteOrder = currentTimeInSeconds >= expectedTimeInSeconds - config.MARGIN_OF_ERROR_SECONDS;

  if (shouldCompleteOrder) {
    orderStatus.completed = true;
    logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, false, false, currentSupply);
    return;
  }

  if (!orderStatus.prematureLogged) {
    logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, true, false, currentSupply);
    orderStatus.prematureLogged = true;
  }
}

/**
 * Logs build order step status.
 * @param {import('../../core/globalTypes').BuildOrderStep} order - The build order step.
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds - The current game time in seconds.
 * @param {number} expectedTimeInSeconds - The expected time for the order in seconds.
 * @param {string} timeStatus - The time status (ahead/behind schedule).
 * @param {number} timeDifference - The time difference between current and expected time.
 * @param {number} supplyDifference - The supply difference between current and expected supply.
 * @param {boolean} isPremature - Whether the completion is premature.
 * @param {boolean} isDelayed - Whether the step is delayed.
 * @param {number} currentSupply - The current supply value.
 */
function logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, isPremature, isDelayed, currentSupply) {
  const { supply, time, action } = order;
  const formattedCurrentTime = currentTimeInSeconds.toFixed(2);
  const formattedExpectedTime = expectedTimeInSeconds.toFixed(2);
  const formattedTimeDifference = Math.abs(timeDifference).toFixed(2);

  let logMessage;
  if (isDelayed) {
    logMessage = `Build Order Step NOT Completed: Step-${index} Supply-${supply} Time-${time} Action-${action}. Expected by time ${time}, current time is ${formattedCurrentTime} seconds. Current Supply: ${currentSupply}. Time Difference: ${formattedTimeDifference} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`;
    console.warn(logMessage);
  } else {
    logMessage = `Build Order Step ${isPremature ? 'Prematurely ' : ''}Completed: Step-${index} Supply-${supply} Time-${time} Action-${action} at game time ${formattedCurrentTime} seconds. ${isPremature ? `Expected time: ${formattedExpectedTime} seconds. ` : ''}Current Supply: ${currentSupply}. Time Difference: ${formattedTimeDifference} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`;
    console.log(logMessage);
  }
}

/**
 * Processes a single step in the build order.
 * @param {Object} params - Parameters object.
 * @param {import('../../core/globalTypes').BuildOrderStep} params.order - The build order step.
 * @param {number} params.index - The index of the build order step.
 * @param {number} params.currentTimeInSeconds - The current game time in seconds.
 * @param {number} params.expectedTimeInSeconds - The expected time for the order in seconds.
 * @param {number} params.currentSupply - The current supply count.
 * @param {string} params.timeStatus - The time status (ahead/behind schedule).
 * @param {number} params.timeDifference - The time difference between current and expected time.
 * @param {number} params.supplyDifference - The supply difference between current and expected supply.
 * @param {{completed: boolean; logged: boolean; prematureLogged: boolean;}} params.orderStatus - The status of the order (completed, logged, prematureLogged).
 * @param {World} params.world - The current game world state.
 * @param {StrategyManager} params.strategyManager - The strategy manager instance.
 * @returns {boolean} - Whether the step is completed.
 */
function processBuildOrderStep({
  order,
  index,
  currentTimeInSeconds,
  expectedTimeInSeconds,
  currentSupply,
  timeStatus,
  timeDifference,
  supplyDifference,
  orderStatus,
  world,
  strategyManager
}) {
  const satisfied = strategyManager.isStepSatisfied(world, order);

  if (satisfied && isStepInProgress(world, order)) {
    handleStepInProgress(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, currentSupply, orderStatus);
  } else {
    checkAndLogDelayedStep(currentTimeInSeconds, expectedTimeInSeconds, orderStatus, order, index, timeStatus, timeDifference, supplyDifference, currentSupply);
  }

  return orderStatus.completed;
}

/**
 * Converts a time string in the format "MM:SS" to seconds.
 * @param {string} timeString - The time string to convert.
 * @returns {number} The corresponding time in seconds.
 */
function timeStringToSeconds(timeString) {
  const [minutes, seconds] = timeString.split(':').map(Number);
  return minutes * 60 + seconds;
}

module.exports = {
  trackBuildOrderProgress,
  // Other exported functions...
};
