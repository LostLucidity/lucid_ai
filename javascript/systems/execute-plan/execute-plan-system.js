//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Attribute } = require("@node-sc2/core/constants/enums");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const { build, train, upgrade } = require("./plan-actions");

module.exports = createSystem({
  name: 'ExecutePlanSystem',
  type: 'agent',
  async onStep(world) {
    const { units } = world.resources.get();
    sharedService.removePendingOrders(units);
    planService.continueBuild = true;
    const { plan } = planService;
    for (let step = 0; step < plan.length; step++) {
      if (planService.continueBuild) {
        planService.currentStep = step;
        const planStep = plan[step];
        const { food, orderType, unitType } = planStep;
        if (world.agent.foodUsed >= food) {
          if (orderType === 'UnitType') {
            const { targetCount } = planStep;
            if (world.data.getUnitTypeData(unitType).attributes.includes(Attribute.STRUCTURE)) {
              await build(world, unitType, targetCount);
            } else {
              await train(world, unitType, targetCount);
            };
          } else if (orderType === 'Upgrade') {
            await upgrade(world, planStep.upgrade);
          }
        } else { break; }
      } else {
        break;
      }
    }
  },
  async onUnitDestroyed({ }, destroyedUnit) {
    if (destroyedUnit.isWorker()) {
      planService.pauseBuilding = false;
    }
  }
});