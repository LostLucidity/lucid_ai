const { Race } = require("@node-sc2/core/constants/enums");
const planService = require("../../../services/plan-service");
const unitRetrievalService = require("../unit-retrieval");

/** @type {{foodUsed: number}} */
const foodData = {
  foodUsed: 12,
  // you can add other related data here
};

/**
 * Update the food used based on the world state.
 * @param {World} world - The current world state.
 */
function setFoodUsed(world) {
  const { agent } = world;
  const { foodUsed, race } = agent;
  if (foodUsed === undefined) { return 0; }
  const pendingFoodUsed = race === Race.ZERG ? unitRetrievalService.getWorkers(world).filter(worker => worker.isConstructing()).length : 0;
  const calculatedFoodUsed = foodUsed + planService.pendingFood - pendingFoodUsed;
  foodData.foodUsed = calculatedFoodUsed;
}

module.exports = {
  foodData,
  setFoodUsed,
};