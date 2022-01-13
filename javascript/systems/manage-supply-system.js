//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Race } = require("@node-sc2/core/constants/enums");
const { SUPPLYDEPOT, PYLON, OVERLORD } = require("@node-sc2/core/constants/unit-type");
const planService = require("../services/plan-service");
const { isSupplyNeeded } = require("../services/world-service");
const { build, train } = require("./execute-plan/plan-actions");

module.exports = createSystem({
  name: 'ManageSupplySystem',
  type: 'agent',
  async onStep(world) {
    const { agent } = world;
    const conditions = [
      isSupplyNeeded(world) &&
      (agent.foodUsed > planService.planMax.supplyDepot || agent.minerals > 512)
    ];
    if (conditions.some(condition => condition)) {
      switch (agent.race) {
        case Race.TERRAN: await build(world, SUPPLYDEPOT); break;
        case Race.PROTOSS: await build(world, PYLON); break;
        case Race.ZERG: await train(world, OVERLORD); break;
      }
    }
  }
});