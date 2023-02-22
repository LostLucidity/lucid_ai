//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const dataService = require("../../services/data-service");
const { setUnitTypeTrainingAbilityMapping } = require("../../services/data-service");
const planService = require("../../services/plan-service");
const { runPlan } = require("../../services/world-service");

module.exports = createSystem({
  name: 'ExecutePlanSystem',
  type: 'agent',
  async onGameStart(world) {
    const { data } = world;
    setUnitTypeTrainingAbilityMapping(data);
    await runPlan(world);
    dataService.clearEarmarks(data);
  },
  async onStep(world) {
    const { data } = world;
    await runPlan(world);
    dataService.clearEarmarks(data);
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