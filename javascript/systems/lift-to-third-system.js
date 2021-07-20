//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { liftToThird } = require("../helper/terran");

module.exports = createSystem({
  name: 'LiftToThird',
  type: 'agent',
  async onStep(world) {
    const { agent, resources } = world;
    if (resources.get().units.getById(TownhallRace[agent.race]).length >= 2) {
      await liftToThird(resources);
    }
  }
});