//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const dataService = require("../../services/data-service");
const { getAllActions } = require("../../services/data-service");
const { runPlan, setFoodUsed } = require("../../services/world-service");
const { executeAction } = require("./q-table-service");
const qTableService = require("./q-table-service");
const planService = require("../../services/plan-service");

module.exports = createSystem({
  name: 'QTableSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 2**1,
  },
  async onGameStart(world) {
    const { data } = world;
    dataService.setGameData(data);
    qTableService.Q = await qTableService.getQTable();
    setFoodUsed(world);
    planService.automateSupply = false;
    await runPlan(world);
    await executeQLearning(world);
  },
  async onStep(world) {
    await runPlan(world);
    await executeQLearning(world);
  }
});

/**
 * @param {World} world 
 * @returns {Promise<void>}
 */
async function executeQLearning(world) {
  const { data } = world;
  const { steps } = qTableService;
  const state = { step: steps.length };
  const availableActions = dataService.getAllAvailableAbilities(world);
  const stateIndex = qTableService.getStateIndex(state);
  const actionIndex = qTableService.chooseAction(stateIndex, availableActions);
  const action = getAllActions()[actionIndex];
  if (action) {
    console.log('action', action);
  }
  availableActions.get(action);
  await executeAction(world, action, availableActions);
  dataService.clearEarmarks(data);
}
