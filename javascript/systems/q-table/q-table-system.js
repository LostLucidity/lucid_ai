//@ts-check
"use strict"

// Core and service imports
const { createSystem } = require("@node-sc2/core");
const dataService = require("../../services/data-service");
const qTableService = require("./q-table-service");
const planService = require("../../services/plan-service");
const { executeAction } = require("./q-table-service");
const { runPlan } = require("../../src/services/plan-management");
const { setFoodUsed } = require("../../src/shared-utilities/data-utils");

module.exports = createSystem({
  name: 'QTableSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 2 ** 1,
  },
  async onGameStart(world) {
    initGame(world);
    await runQLearningStep(world);
  },
  async onStep(world) {
    await runQLearningStep(world);
  }
});

/**
 * Initial setup for the game start.
 * @param {World} world 
 */
function initGame(world) {
  const { data } = world;
  dataService.setGameData(data);
  qTableService.Q = qTableService.getQTable();  // Assuming a synchronous version exists
  setFoodUsed(world);
  planService.automateSupply = false;
}

/**
 * Execute Q-learning logic.
 * @param {World} world 
 * @returns {Promise<void>}
 */
async function runQLearningStep(world) {
  await runPlan(world);  // Running the plan

  const { data } = world;
  const { steps } = qTableService;

  const state = { step: steps.length };
  const availableActions = dataService.getAllAvailableAbilities(world);
  const action = chooseQLearningAction(state, availableActions);

  if (action) {
    console.log('Action:', action);
  }

  await executeAction(world, action, availableActions);
  dataService.clearEarmarks(data);
}

/**
 * Choose an action based on Q-learning.
 * @param {Object} state 
 * @param {Map<number, import("../../interfaces/actions-map").ActionsMap>} availableActions 
 * @returns {any} Chosen action.
 */
function chooseQLearningAction(state, availableActions) {
  const stateIndex = qTableService.getStateIndex(state);
  const actionIndex = qTableService.chooseAction(stateIndex, availableActions);
  return dataService.getAllActions()[actionIndex];
}
