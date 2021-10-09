//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { workerSendOrBuild } = require("../helper");
const { getStringNameOfConstant } = require("../services/logging-service");
const loggingService = require("../services/logging-service");
const { addEarmark } = require("../services/plan-service");
const planService = require("../services/plan-service");
const { balanceForFuture } = require("../systems/manage-resources");
const canAfford = require("./can-afford");
const { getAvailableExpansions, getNextSafeExpansion } = require("./expansions");

module.exports = {
  expand: async (world) => {
    const { agent, data, resources } = world;
    let collectedActions = [];
    const { actions, frame, units } = resources.get();
    const availableExpansions = getAvailableExpansions(resources);
    const expansionLocation = availableExpansions.length > 0 ? await getNextSafeExpansion(world, availableExpansions) : null;
    if (expansionLocation) {
      const townhallType = TownhallRace[agent.race][0];
      if (canAfford(agent, data, townhallType)) {
        const buildAbilityId = data.getUnitTypeData(townhallType).abilityId;
        if ((units.inProgress(townhallType).length + units.withCurrentOrders(buildAbilityId).length) < 1) {
          const unitTypeData = data.getUnitTypeData(townhallType);
          await actions.sendAction(workerSendOrBuild(resources, unitTypeData.abilityId, expansionLocation));
          planService.pausePlan = false;
          loggingService.setAndLogExecutedSteps(agent, frame.timeInSeconds(), getStringNameOfConstant(UnitType, townhallType));
          addEarmark(data, unitTypeData);
        }
      } else {
        collectedActions.push(...workerSendOrBuild(resources, MOVE, expansionLocation));
        await balanceForFuture(world, townhallType);
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  }
}