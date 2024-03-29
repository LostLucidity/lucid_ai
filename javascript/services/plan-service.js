//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { supplyTypes } = require("../helper/groups");

const planService = {
  continueBuild: null,
  currentStep: null,
  foundPosition: null,
  pauseBuilding: null,
  plan: null,
  planMax: {
    gasMine: null,
    supplyDepot: null,
  },
  setPlan: (plan) => {
    planService.plan = plan;
    planService.planMax.supplyDepot = Math.max.apply(Math, plan.filter(step => supplyTypes.includes(step.unitType)).map(step => { return step.food; }));
    planService.planMax.gasMine = Math.max.apply(Math, plan.filter(step => gasMineTypes.includes(step.unitType)).map(step => { return step.food; }));
  },
  scouting: [],
  trainingTypes: null,
  wallOff: null,
}

module.exports = planService;