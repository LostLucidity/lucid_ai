//@ts-check
"use strict"

const { UnitType, UnitTypeId } = require("@node-sc2/core/constants");
const { ability } = require("../services/command-service");
const { unpauseAndLog } = require("../services/shared-functions");
const { addEarmark } = require("./common-utilities");
const loggingService = require("../logging/logging-service");

// building-utils.js in shared-utilities

/**
 * Contains shared building-related utilities used across multiple services.
 */

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function morphStructureAction(world, unitType) {
  const { CYCLONE, LAIR } = UnitType;
  const { agent, data } = world;
  const collectedActions = [];
  // use unitType for LAIR with CYCLONE when can afford as LAIR data is inflated by the cost of a HATCHERY
  if (agent.canAfford(unitType === LAIR ? CYCLONE : unitType)) {
    const { abilityId } = data.getUnitTypeData(unitType); if (abilityId === undefined) return collectedActions;
    const actions = await ability(world, abilityId);
    if (actions.length > 0) {
      unpauseAndLog(world, UnitTypeId[unitType], loggingService,);
      collectedActions.push(...actions);
    }
  }
  addEarmark(data, data.getUnitTypeData(unitType));
  return collectedActions;
}

// Export the utility functions so other modules can use them
module.exports = {
  morphStructureAction
};
