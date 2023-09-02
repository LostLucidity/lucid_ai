//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const dataService = require("../services/data-service");
const planService = require("../services/plan-service");
const { runPlan } = require("../src/world-service");

module.exports = createSystem({
  name: 'DelayedStepSystem',
  type: 'agent',
  defaultOptions: {
    stepIncrement: 2,
  },
  async onStep(world) {
    const { data } = world;
    if (planService.pendingRunPlan) {
      planService.pendingRunPlan = false;
      await runPlan(world);
      dataService.clearEarmarks(data);
    }
  }
});