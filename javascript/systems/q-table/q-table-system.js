//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const dataService = require("../../services/data-service");
const { setUnitTypeTrainingAbilityMapping, setUpgradeAbilities, getAllActions } = require("../../services/data-service");
const { executeAction } = require("./q-table-service");
const qTableService = require("./q-table-service");

module.exports = createSystem({
  name: 'QTableSystem',
  type: 'agent',
  async onGameStart(world) {
    const { data } = world;
    setUnitTypeTrainingAbilityMapping(data);
    setUpgradeAbilities(data);
  },
  async onStep(world) {
    // get food used
    const { agent, data, resources } = world;
    const { foodUsed } = agent; if (!foodUsed) { return; }
    const { units } = resources.get();
    // get state, contains steps and food used
    const { steps } = qTableService;
    const state = { step: steps.length, foodUsed };
    // get available actions
    const availableActions = dataService.getAllAvailableAbilities(data, units);
    // get current state index, if it doesn't exist, create it and add it to the Q table and return the index
    const stateIndex = qTableService.getStateIndex(state);
    // choose action
    const actionIndex = qTableService.chooseAction(stateIndex, availableActions);
    // get action
    const action = getAllActions()[actionIndex];
    // execute action
    console.log('action', action);
    availableActions.get(action);
    await executeAction(world, action, availableActions);
  }
});