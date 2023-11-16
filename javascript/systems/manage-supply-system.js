//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Race } = require("@node-sc2/core/constants/enums");
const { SUPPLYDEPOT, PYLON, OVERLORD } = require("@node-sc2/core/constants/unit-type");
const planService = require("../services/plan-service");
const { build } = require("../src/services/building-management");
const { PlacementService } = require("../src/services/placement");
const { train } = require("../src/shared-utilities/training-utilities");
const { isSupplyNeeded } = require("../src/shared-utilities/supply-utils");

module.exports = createSystem({
  name: 'ManageSupplySystem',
  type: 'agent',
  async onStep(world) {
    const { agent } = world;
    const conditions = [
      isSupplyNeeded(world, 0.2) &&
      (agent.foodUsed > planService.planMax.supply || agent.minerals > 512)
    ];
    if (conditions.some(condition => condition)) {
      switch (agent.race) {
        case Race.TERRAN: {
          const candidatePositions = PlacementService.findPlacements(world, SUPPLYDEPOT);
          await build(world, SUPPLYDEPOT, null, candidatePositions);
          break;
        }
        case Race.PROTOSS: {
          const candidatePositions = PlacementService.findPlacements(world, PYLON);
          await build(world, PYLON, null, candidatePositions);
          break;
        }
        case Race.ZERG: await train(world, OVERLORD); break;
      }
    }
  }
});
