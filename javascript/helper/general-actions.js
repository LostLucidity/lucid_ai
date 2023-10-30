//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const planService = require("../services/plan-service");
const { balanceResources } = require("../systems/manage-resources");
const { getAvailableExpansions, getNextSafeExpansions } = require("./expansions");
const { addEarmark, getStringNameOfConstant } = require("../src/services/shared-utilities/common-utilities");
const { prepareBuilderForConstruction } = require("../src/services/resource-management");
const { commandBuilderToConstruct } = require("../src/services/unit-commands/builder-commands");
const { canBuild } = require("../src/services/shared-utilities/training-shared-utils");
const { getBuilder } = require("../src/services/unit-commands/building-commands");
const { premoveBuilderToPosition } = require("../src/services/shared-utilities/builder-utils");
const loggingService = require("../src/services/logging/logging-service");

module.exports = {
  expand: async (world) => {
    const { agent, data, resources } = world;
    let collectedActions = [];
    const { frame, units } = resources.get();
    const availableExpansions = getAvailableExpansions(resources);
    const [expansionLocation] = availableExpansions.length > 0 ? getNextSafeExpansions(world, availableExpansions) : [];

    if (expansionLocation) {
      const townhallTypeId = TownhallRace[agent.race][0];
      if (canBuild(world, townhallTypeId)) {
        const buildAbilityId = data.getUnitTypeData(townhallTypeId).abilityId;

        if (buildAbilityId !== undefined && (units.inProgress(townhallTypeId).length + units.withCurrentOrders(buildAbilityId).length) < 1) {
          // Prepare builder for construction (Resource Management Logic)
          const builder = prepareBuilderForConstruction(world, townhallTypeId, expansionLocation);

          // If we have a builder, command it to construct (Command Logic)
          if (builder) {
            collectedActions.push(...commandBuilderToConstruct(world, builder, townhallTypeId, expansionLocation));
            const unitTypeData = data.getUnitTypeData(townhallTypeId);
            loggingService.setAndLogExecutedSteps(world, frame.timeInSeconds(), getStringNameOfConstant(UnitType, townhallTypeId));
            addEarmark(data, unitTypeData);
          }

          planService.pausePlan = false;
        }
      } else {
        collectedActions.push(...premoveBuilderToPosition(world, expansionLocation, townhallTypeId, getBuilder));

        const unitTypeData = data.getUnitTypeData(townhallTypeId);
        const { mineralCost, vespeneCost } = unitTypeData;

        if (mineralCost !== undefined && vespeneCost !== undefined) {
          await balanceResources(world, mineralCost / vespeneCost);
        }

        planService.pausePlan = true;
        planService.continueBuild = false;
      }
    }

    return collectedActions;
  }
}