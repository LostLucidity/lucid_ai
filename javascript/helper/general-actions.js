//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const planService = require("../services/plan-service");
const { balanceResources } = require("../systems/manage-resources");
const { getAvailableExpansions, getNextSafeExpansions } = require("./expansions");
const { addEarmark, getStringNameOfConstant } = require("../src/shared-utilities/common-utilities");
const { prepareBuilderForConstruction } = require("../src/services/resource-management");
const { commandBuilderToConstruct } = require("../src/services/unit-commands/builder-commands");
const { canBuild } = require("../src/shared-utilities/training-shared-utils");
const { getBuilder } = require("../src/services/unit-commands/building-commands");
const { premoveBuilderToPosition } = require("../src/shared-utilities/builder-utils");
const { setAndLogExecutedSteps } = require("../src/services/shared-functions");
const serviceLocator = require("../src/services/service-locator");

/** @type {import("../src/interfaces/i-army-management-service").IArmyManagementService} */
const armyManagementService = serviceLocator.get('armyManagementService');
/** @type {import("../src/interfaces/i-logging-service").ILoggingService} */
const loggingService = serviceLocator.get('loggingService');

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
            setAndLogExecutedSteps(world, frame.timeInSeconds(), getStringNameOfConstant(UnitType, townhallTypeId), loggingService, armyManagementService);
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