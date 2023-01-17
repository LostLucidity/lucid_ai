//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Race } = require("@node-sc2/core/constants/enums");
const { SUPPLYDEPOT, PYLON, OVERLORD } = require("@node-sc2/core/constants/unit-type");
const planService = require("../services/plan-service");
const { isSupplyNeeded, findPlacements, train } = require("../services/world-service");
const { build } = require("./execute-plan/plan-actions");

module.exports = createSystem({
  name: 'ManageSupplySystem',
  type: 'agent',
  async onStep(world) {
    const { agent, data } = world;
    clearEarmarks(data);
    const conditions = [
      isSupplyNeeded(world, 0.2) &&
      (agent.foodUsed > planService.planMax.supplyDepot || agent.minerals > 512)
    ];
    if (conditions.some(condition => condition)) {
      switch (agent.race) {
        case Race.TERRAN: {
          const candidatePositions = await findPlacements(world, SUPPLYDEPOT);
          await build(world, SUPPLYDEPOT, null, candidatePositions);
          break;
        }
        case Race.PROTOSS: {
          const candidatePositions = await findPlacements(world, PYLON);
          await build(world, PYLON, null, candidatePositions);
          break;
        }
        case Race.ZERG: await train(world, OVERLORD); break;
      }
    }
  }
});

/**
 * @param {DataStorage} data
 * @returns {void}
 */
function clearEarmarks(data) {
  data.get('earmarks').forEach((/** @type {Earmark} */ earmark) => data.settleEarmark(earmark.name));
}
