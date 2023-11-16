//@ts-check
"use strict";

const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const expansionManagementService = require("../expansion-management/expansion-management-service");
const { addEarmark } = require("../../shared-utilities/common-utilities");
const { getBuilder } = require("../unit-commands/building-commands");

/**
 * Prepares a builder for construction and earmarks resources.
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @param {Point2D} position
 * @returns {Unit | null} The selected builder or null if none found.
 */
function prepareBuilderForConstruction(world, unitType, position) {
  const { agent, data } = world;
  const { race } = agent;

  let builder = getBuilder(world, position);

  if (builder) {
    const { unit } = builder;
    addEarmark(data, data.getUnitTypeData(unitType));

    if (TownhallRace[race].indexOf(unitType) === 0) {
      expansionManagementService.setAvailableExpansions([]);
    }

    return unit;
  }

  return null;
}

module.exports = {
  prepareBuilderForConstruction,
};