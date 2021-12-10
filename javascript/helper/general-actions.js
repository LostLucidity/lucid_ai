//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { addEarmark } = require("../services/data-service");
const { getStringNameOfConstant } = require("../services/logging-service");
const planService = require("../services/plan-service");
const { premoveBuilderToPosition } = require("../systems/unit-resource/unit-resource-service");
const { assignAndSendWorkerToBuild, setAndLogExecutedSteps } = require("../services/world-service");
const { balanceResources } = require("../systems/manage-resources");
const canAfford = require("./can-afford");
const { getAvailableExpansions, getNextSafeExpansion } = require("./expansions");

module.exports = {
  /**
   * 
   * @param {World} world 
   * @returns 
   */
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
          await actions.sendAction(assignAndSendWorkerToBuild(world, townhallType, expansionLocation));
          planService.pausePlan = false;
          setAndLogExecutedSteps(world, frame.timeInSeconds(), getStringNameOfConstant(UnitType, townhallType));
          addEarmark(data, unitTypeData);
        }
      } else {
        collectedActions.push(...premoveBuilderToPosition(units, expansionLocation));
        const { mineralCost, vespeneCost } = data.getUnitTypeData(townhallType);
        await balanceResources(world, mineralCost / vespeneCost);
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  }
}