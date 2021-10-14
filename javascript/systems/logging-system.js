//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const loggingService = require("../services/logging-service");
const planService = require("../services/plan-service");

module.exports = createSystem({
  name: 'Logging',
  type: 'agent',
  async onStep({ agent, resources }) {
    const formattedTime = loggingService.formatToMinutesAndSeconds(resources.get().frame.timeInSeconds());
    const { foodUsed, minerals, vespene } = agent;
    console.log(`foodUsed: ${foodUsed}, timeInSeconds: ${formattedTime}, isPlanPaused: ${planService.isPlanPaused}, step: ${planService.currentStep}, resources: ${minerals}/${vespene}`);
  }
});