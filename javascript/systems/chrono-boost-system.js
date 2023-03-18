//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { maxEnergyNexusChronoboost } = require("./unit-resource/unit-resource-service");

module.exports = createSystem({
  name: 'ChronoBoostSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { actions, units } = resources.get();
    const collectedActions = [];
    collectedActions.push(...maxEnergyNexusChronoboost(units));
    if (collectedActions.length > 0) actions.sendAction(collectedActions);
  }
});
