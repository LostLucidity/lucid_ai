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
    if (planService.isPlanPaused !== value) {
      // check currentStep
      planService.isPlanPaused = value;
      console.log(`Current step: ${planService.currentStep}`);
    }
    planService.pausedThisRound = value;
  },
  /** @type {boolean} */
  automateSupply: true,
  /** @type {boolean} */
  bogIsActive: false,
  dirtyBasePlan: false,
  /** @type {import("../interfaces/plan-step").PlanStep[]} */
  convertedLegacyPlan: [],
  continueBuild: true,
  /** @type {number} */
  foodMark: 12,
  /** @type {{enemyBuild?: string; units: {STALKER?: number; } } | null} */
  harass: null,
  /** @type {boolean} */
  isPlanPaused: null,
  latestStep: 0,
  mineralThreshold: 512,
  /** @type {boolean} */
  pausedThisRound: false,
  /** @type {boolean} */
  pendingRunPlan: false,
  planMax: {
    gasMine: 0,
    supply: 0,
  },
  /**
   * @param {{ orderType: string, unitType?: UnitTypeId?; food: number, targetCount?: number, upgrade?: number, candidatePositions?: Point2D[] }[]}  plan 
   */
  setPlan: (plan, islegacyPlan = false) => {
    planService.plan = plan;
    planService.planMax.supply = planService.setSupplyMax(plan, islegacyPlan);
    planService.planMax.gasMine = Math.max.apply(Math, plan.filter(step => gasMineTypes.includes(step.unitType)).map(step => { return step.food; }));
    planService.trainingTypes.forEach(type => {
      planService.planMin[UnitTypeId[type]] = Math.min.apply(Math, plan.filter(step => step.unitType === type).map(step => { return step.food; }));
    });
  },
  /**
   * @param {import("../interfaces/plan-step").PlanStep[]} plan
   * @param {boolean} islegacyPlan
   * @returns {number}
   */
  setSupplyMax: (plan, islegacyPlan = false) => {
    plan = islegacyPlan ? planService.convertLegacyPlan(plan) : plan;
    const filteredPlan = plan.filter(step => {
      const { unitType } = step; if (unitType === null || unitType === undefined) { return false; }
      return supplyTypes.includes(unitType);
    }).map(step => { return step.food; })
    return Math.max.apply(Math, filteredPlan);
  },
  getNextPlanStep: (foodUsed) => {
    return planService.legacyPlan.find(order => Number.isInteger(order[0]) && order[0] > foodUsed);
  },
  rallies: [],
  scouts: [],
  wallOff: null,
}

module.exports = planService;

