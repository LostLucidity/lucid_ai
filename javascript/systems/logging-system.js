//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const planService = require("../services/plan-service");

module.exports = createSystem({
  name: 'Logging',
  type: 'agent',
  async onStep({ agent, resources }) {
    console.log(`foodUsed: ${agent.foodUsed}, timeInSeconds: ${resources.get().frame.timeInSeconds()}, isPlanPaused: ${planService.isPlanPaused}, step: ${planService.currentStep}`);
  },
});