//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { supplyTypes } = require("../helper/groups");

const planService = {
  set pausePlan(value) {
    planService.isPlanPaused = value;
  },
  addEarmark: (data, orderData) => {
    data.addEarmark({
      name: `${planService.currentStep}`,
      minerals: orderData.mineralCost,
      vespene: orderData.vespeneCost,
    });
  },
  dirtyBasePlan: false,
  continueBuild: null,
  currentStep: 0,
  getFoodUsed: (foodused) => {
    return foodused + planService.pendingFood;
  },
  foundPosition: null,
  isPlanPaused: null,
  legacyPlan: null,
  pendingFood: 0,
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
  getNextPlanStep: (foodUsed) => {
    return planService.legacyPlan.find(order => Number.isInteger(order[0]) && order[0] > foodUsed);
  },
  scouting: [],
  trainingTypes: null,
  wallOff: null,
}

module.exports = planService;