//@ts-check
"use strict"

const { supplyTypes } = require("../helper/groups");

const planService = {
  continueBuild: null,
  currentStep: null,
  foundPosition: null,
  pauseBuilding: null,
  plan: null,
  setPlan: (plan) => {
    planService.plan = plan;
    planService.supplyMax = Math.max.apply(Math, plan.filter(step => supplyTypes.includes(step.unitType)).map(step => { return step.food; }))
  },
  scouting: [],
  supplyMax: null,
  trainingTypes: null,
  wallOff: null,
}

module.exports = planService;