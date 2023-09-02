//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { updateCreepPositionsSet } = require("./map-resource-service");

module.exports = createSystem({
  name: 'MapResourceSystem',
  type: 'agent',
  async onGameStart(world) {
    const { resources } = world;
    const { map } = resources.get();
    updateCreepPositionsSet(map)
  },
  async onStep(world) {
    const { resources } = world;
    const { map } = resources.get();
    updateCreepPositionsSet(map)
  }
});
