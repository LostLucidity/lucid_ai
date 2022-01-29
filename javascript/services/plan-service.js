//@ts-check
"use strict"

const { UnitTypeId } = require("@node-sc2/core/constants");
const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { supplyTypes } = require("../helper/groups");

const planService = {
  /**
   * @param {boolean} value
   */
  set pausePlan(value) {
    planService.isPlanPaused = value;
  },
  dirtyBasePlan: false,
  continueBuild: null,
  currentStep: 0,
  getFoodUsed: (foodused) => {
    return foodused + planService.pendingFood;
  },
  foundPosition: null,
  /** @type {boolean} */
  isPlanPaused: null,
  latestStep: 0,
  legacyPlan: null,
  pendingFood: 0,
  /** @type {{ orderType: string, unitType?: UnitTypeId?; food: number, targetCount?: number, upgrade?: number, candidatePositions?: Point2D[] }[]} */
  plan: null,
  planMax: {
    gasMine: null,
    supplyDepot: null,
  },
  planMin: {},
  /**
   * @param {{ orderType: string, unitType?: UnitTypeId?; food: number, targetCount?: number, upgrade?: number, candidatePositions?: Point2D[] }[]}  plan 
   */
  setPlan: (plan) => {
    planService.plan = plan;
    planService.planMax.supplyDepot = Math.max.apply(Math, plan.filter(step => supplyTypes.includes(step.unitType)).map(step => { return step.food; }));
    planService.planMax.gasMine = Math.max.apply(Math, plan.filter(step => gasMineTypes.includes(step.unitType)).map(step => { return step.food; }));
    planService.trainingTypes.forEach(type => {
      planService.planMin[UnitTypeId[type]] = Math.min.apply(Math, plan.filter(step => step.unitType === type).map(step => { return step.food; }));
    });
  },
  getNextPlanStep: (foodUsed) => {
    return planService.legacyPlan.find(order => Number.isInteger(order[0]) && order[0] > foodUsed);
  },
  scouting: [],
  /** @type {number[]} */
  trainingTypes: null,
  wallOff: null,
}

module.exports = planService;
