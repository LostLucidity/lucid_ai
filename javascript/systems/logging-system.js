//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { DRONE, LARVA } = require("@node-sc2/core/constants/unit-type");
const loggingService = require("../services/logging-service");
const { getStringNameOfConstant } = require("../services/logging-service");
const planService = require("../services/plan-service");

module.exports = createSystem({
  name: 'Logging',
  type: 'agent',
  async onStep({ agent, resources }) {
    const formattedTime = loggingService.formatToMinutesAndSeconds(resources.get().frame.timeInSeconds());
    console.log(`foodUsed: ${agent.foodUsed}, timeInSeconds: ${formattedTime}, isPlanPaused: ${planService.isPlanPaused}, step: ${planService.currentStep}`);
  }
});