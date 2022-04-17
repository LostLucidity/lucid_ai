//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { setUnitTypeTrainingAbilityMapping } = require("../../services/data-service");
const planService = require("../../services/plan-service");
const sharedService = require("../../services/shared-service");
const { runPlan } = require("./plan-actions");

module.exports = createSystem({
  name: 'ExecutePlanSystem',
  type: 'agent',
  async onGameStart(world) {
    const { data } = world;
    setUnitTypeTrainingAbilityMapping(data);
  },
  async onStep(world) {
    const { data, resources } = world;
    const { units } = resources.get();
    sharedService.removePendingOrders(units);
    await runPlan(world);
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