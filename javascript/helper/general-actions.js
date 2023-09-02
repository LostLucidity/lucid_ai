//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { getStringNameOfConstant } = require("../services/logging-service");
const planService = require("../services/plan-service");
const { assignAndSendWorkerToBuild, setAndLogExecutedSteps, premoveBuilderToPosition, canBuild, addEarmark } = require("../src/world-service");
const { balanceResources } = require("../systems/manage-resources");
const { getAvailableExpansions, getNextSafeExpansions } = require("./expansions");

module.exports = {
  /**
   * @param {World} world 
   * @returns 
   */
  expand: async (world) => {
    const { agent, data, resources } = world;
    let collectedActions = [];
    const { actions, frame, units } = resources.get();
    const availableExpansions = getAvailableExpansions(resources);
    const [expansionLocation] = availableExpansions.length > 0 ? getNextSafeExpansions(world, availableExpansions) : [];
    if (expansionLocation) {
      const townhallTypeId = TownhallRace[agent.race][0];
      if (canBuild(world, townhallTypeId)) {
        const buildAbilityId = data.getUnitTypeData(townhallTypeId).abilityId;
        if ((units.inProgress(townhallTypeId).length + units.withCurrentOrders(buildAbilityId).length) < 1) {
          const unitTypeData = data.getUnitTypeData(townhallTypeId);
          await actions.sendAction(assignAndSendWorkerToBuild(world, townhallTypeId, expansionLocation));
          setAndLogExecutedSteps(world, frame.timeInSeconds(), getStringNameOfConstant(UnitType, townhallTypeId));
          addEarmark(data, unitTypeData);
        }
        planService.pausePlan = false;
      } else {
        collectedActions.push(...premoveBuilderToPosition(world, expansionLocation, townhallTypeId));
        const { mineralCost, vespeneCost } = data.getUnitTypeData(townhallTypeId);
        await balanceResources(world, mineralCost / vespeneCost);
        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }
    return collectedActions;
  }
}