//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const dataService = require("../../services/data-service");
const { setUnitTypeTrainingAbilityMapping, setUpgradeAbilities, getAllActions, setCuratedAbilityMapping } = require("../../services/data-service");
const { runPlan } = require("../../services/world-service");
const { executeAction } = require("./q-table-service");
const qTableService = require("./q-table-service");

module.exports = createSystem({
  name: 'QTableSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 2**1,
  },
  async onGameStart(world) {
    const { data } = world;
    setUnitTypeTrainingAbilityMapping(data);
    setUpgradeAbilities(data);
    setCuratedAbilityMapping(data);
    qTableService.Q = await qTableService.getQTable();
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
  const { data, resources } = world;
  const { units } = resources.get();
  const { steps } = qTableService;
  const state = { step: steps.length };
  const availableActions = dataService.getAllAvailableAbilities(data, units);
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
