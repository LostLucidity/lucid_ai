//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const AssemblePlan  = require("../helper/assemblePlan");
const { onStep } = require("../systems/macro");
const plans = require("./protoss/plans");

let assemblePlan = null;

const entry = createSystem({
  name: 'main',
  type: 'agent',
  async onGameStart(world) {
    // get race.
    const race = world.agent.race;
    // get build
    const plan = plans[race]['economicStalkerColossi'];
    // load build
    assemblePlan = new AssemblePlan(plan);
    assemblePlan.onGameStart(world)
  },
  async onStep(world) {
    assemblePlan.onStep(world, this.state)
  }
});

module.exports = entry;