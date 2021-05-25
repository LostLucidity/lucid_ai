//@ts-check
"use strict"

const planService = {
  continueBuild: null,
  foundPosition: null,
  pauseBuilding: null,
  plan: null,
  setPlan: (plan) => {
    planService.plan = plan;
  },
  trainingTypes: null,
}

module.exports = planService;