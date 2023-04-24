//@ts-check
"use strict"

const { UnitTypeId } = require("@node-sc2/core/constants");
const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { supplyTypes } = require("../helper/groups");

const planService = {
  /** @type {false | Point2D | undefined} */
  get buildingPosition() {
    const step = planService.currentStep;
    return planService.buildingPositions.get(step);
  },
  /**
   * @param {false | Point2D} value
   * @returns {void}
   */
  set buildingPosition(value) {
    if (value) {
      const step = planService.currentStep;
      planService.buildingPositions.set(step, value);
    }
  },
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
  bogIsActive: false,
  /** @type {Map<number, false | Point2D>} */
  buildingPositions: new Map(),
  dirtyBasePlan: false,
  /** @type {import("../interfaces/plan-step").PlanStep[]} */
  convertedLegacyPlan: [],
  continueBuild: true,
  currentStep: -1,
  /** @type {number} */
  foodMark: 12,
  /** @type {Point2D | false} */
  foundPosition: false,
  /** @type {{enemyBuild?: string; units: {STALKER?: number; } } | null} */
  harass: null,
  /** @type {boolean} */
  isPlanPaused: null,
  latestStep: 0,
  /** @type {any[][]} */
  legacyPlan: [],
  mineralThreshold: 512,
  naturalWallPylon: true,
  /** @type {boolean} */
  pausedThisRound: false,
  pendingFood: 0,
  /** @type {boolean} */
  pendingRunPlan: false,
  /** @type {(import("../interfaces/plan-step").PlanStep[])} */
  plan: [],
  planMax: {
    gasMine: 0,
    supply: 0,
  },
  planMin: {},
  /**
   * @param {any[]} legacyPlan
   * @returns {import("../interfaces/plan-step").PlanStep[]}
   */
  convertLegacyPlan(legacyPlan) {
    const trueActions = ['build', 'train', 'upgrade'];
    return legacyPlan.filter(step => {
      return trueActions.includes(step[1]);
    }).map(step => {
      return planService.convertLegacyStep(step);
    });
  },
  /**
   * @description converts a legacy step to a new step, legacy step is an array of [food, orderType, unitType, targetCount]
   * @param {any[]} trueStep
   * @returns {import("../interfaces/plan-step").PlanStep}
   */
  convertLegacyStep(trueStep) {
    const [food, orderType, unitType, targetCount] = trueStep;
    return {
      food,
      orderType,
      unitType,
      targetCount,
    };  
  },
  /**
   * @param {UnitTypeId} unitType
   * @param {Point2D | false} position
   * @returns {void}
   */
  setBuildingPosition: (unitType, position) => {
    if (planService.legacyPlan[planService.currentStep][2] === unitType) {
      planService.buildingPosition = position;
    }
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
  /** @type {number[]} */
  trainingTypes: [],
  /** @type {{}} */
  unitMax: {},
  wallOff: null,
}

module.exports = planService;

