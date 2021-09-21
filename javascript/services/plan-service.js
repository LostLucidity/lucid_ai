//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { supplyTypes } = require("../helper/groups");

const planService = {
  set pausePlan(value) {
    planService.isPlanPaused = value;
  },
  continueBuild: null,
  currentStep: null,
  foundPosition: null,
  isPlanPaused: null,
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
  getNextPlanStep: (planOrders, foodUsed) => {
    return planOrders.find(order => Number.isInteger(order[0]) && order[0] > foodUsed);
  },
  scouting: [],
  trainingTypes: null,
  wallOff: null,
}

module.exports = planService;