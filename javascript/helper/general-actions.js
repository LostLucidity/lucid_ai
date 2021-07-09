//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { workerSendOrBuild } = require("../helper");
const planService = require("../services/plan-service");
const { balanceForFuture } = require("../systems/manage-resources");
const canAfford = require("./can-afford");
const { getAvailableExpansions, getNextSafeExpansion } = require("./expansions");

module.exports = {
  expand: async (world, state={}) => {
    const { agent, data, resources } = world;
    let collectedActions = [];
    const { actions, units } = resources.get();
    const availableExpansions = getAvailableExpansions(resources);
    const expansionLocation = availableExpansions.length > 0 ? await getNextSafeExpansion(world, availableExpansions) : null;
    if (expansionLocation) {
      const townhallType = TownhallRace[agent.race][0];
      if (canAfford(agent, data, townhallType)) {
        const buildAbilityId = data.getUnitTypeData(townhallType).abilityId;
        if ((units.inProgress(townhallType).length + units.withCurrentOrders(buildAbilityId).length) < 1 ) {
          await actions.sendAction(workerSendOrBuild(resources, data.getUnitTypeData(townhallType).abilityId, expansionLocation));
          state.pauseBuilding = false;
          planService.pauseBuilding = false;
        }
      } else {
        collectedActions.push(...workerSendOrBuild(resources, MOVE, expansionLocation));
        const {mineralCost, vespeneCost} = data.getUnitTypeData(townhallType);
        await balanceResources(world, mineralCost/vespeneCost);
        state.pauseBuilding = true;
        state.continueBuild = false;
        planService.pauseBuilding = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  }
}