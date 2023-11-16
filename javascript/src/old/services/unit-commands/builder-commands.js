//@ts-check
"use strict";

// builder-commands.js

// 1. Required imports
const unitService = require('../../../services/unit-service');
const { isPendingContructing } = require('../../../services/shared-service');
const { createUnitCommand } = require('../../shared-utilities/command-utilities');
const { GasMineRace } = require('@node-sc2/core/constants/race-map');
const unitResourceService = require('../../../systems/unit-resource/unit-resource-service');
const { setBuilderLabel } = require('../../shared-utilities/builder-utils');

// 2. Main functionality
/**
 * Commands the provided builder to construct a structure.
 * @param {World} world 
 * @param {Unit} builder The builder to command.
 * @param {UnitTypeId} unitType 
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function commandBuilderToConstruct(world, builder, unitType, position) {
  const { setPendingOrders } = unitService;
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const { abilityId } = data.getUnitTypeData(unitType);

  const collectedActions = [];

  if (!builder.isConstructing() && !isPendingContructing(builder) && abilityId !== undefined) {
    setBuilderLabel(builder);
    const unitCommand = createUnitCommand(abilityId, [builder]);

    if (GasMineRace[agent.race] === unitType) {
      const closestGasGeyser = units.getClosest(position, units.getGasGeysers())[0];
      if (closestGasGeyser) {
        unitCommand.targetUnitTag = closestGasGeyser.tag;
      }
    } else {
      unitCommand.targetWorldSpacePos = position;
    }

    collectedActions.push(unitCommand);
    setPendingOrders(builder, unitCommand);
    collectedActions.push(...unitResourceService.stopOverlappingBuilders(units, builder, position));
  }

  return collectedActions;
}


// 3. Exports
module.exports = {
  commandBuilderToConstruct
};
