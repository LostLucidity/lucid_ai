//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Attribute, Alliance } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const { build, train, upgrade } = require("./plan-actions");

module.exports = createSystem({
  name: 'ExecutePlanSystem',
  type: 'agent',
  async onStep(world) {
    const { data, resources } = world;
    const { units } = resources.get();
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
    data.get('earmarks').forEach(earmark => data.settleEarmark(earmark.name));
  },
  async onUnitDestroyed({ agent }, destroyedUnit) {
    if (
      (WorkerRace[agent.race] === destroyedUnit.unitType) &&
      destroyedUnit.alliance === Alliance.ALLY
    ) {
      planService.pausePlan = false;
    }
  }
});