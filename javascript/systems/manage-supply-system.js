//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Race } = require("@node-sc2/core/constants/enums");
const { SUPPLYDEPOT, PYLON, OVERLORD } = require("@node-sc2/core/constants/unit-type");
const isSupplyNeeded = require("../helper/supply");
const planService = require("../services/plan-service");
const { build, train } = require("./execute-plan/plan-actions");

module.exports = createSystem({
  name: 'ManageSupplySystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data, resources } = world;
    if (agent.foodUsed > planService.supplyMax && isSupplyNeeded(agent, data, resources)) {
      switch (agent.race) {
        case Race.TERRAN:
          await build(world, SUPPLYDEPOT)
        case Race.PROTOSS:
          await build(world, PYLON);
          break;
        case Race.ZERG:
          let abilityId = data.getUnitTypeData(OVERLORD).abilityId;
          await train(world, OVERLORD);
          break;
      }
    }
  }
});