//@ts-check
"use strict"

/**
 * This service handles the creation of unit commands.
 */

const { Ability, UnitType } = require("@node-sc2/core/constants");
const { prepareBuilderForConstruction } = require("./resource-management");
const { getBuilder } = require("./unit-commands/building-commands");

/**
 * Creates a command to move a unit to a specified position.
 * 
 * @param {Unit} unit - The unit to move.
 * @param {Point2D} position - The destination position.
 * @returns {SC2APIProtocol.ActionRawUnitCommand | null} - The move command.
 */
function createMoveCommand(unit, position) {
  if (unit.tag) {
    return {
      abilityId: Ability.MOVE,
      targetWorldSpacePos: position,
      unitTags: [unit.tag],
    };
  } else {
    return null;
  }
}

/**
 * Command to place a building at the specified position.
 * 
 * @param {World} world The current world state.
 * @param {number} unitType The type of unit/building to place.
 * @param {?Point2D} position The position to place the unit/building, or null if no valid position.
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} A promise containing a list of raw unit commands.
 */
async function commandPlaceBuilding(world, unitType, position) {
  const { PYLON } = UnitType;
  const { agent, data, resources } = world;
  const { actions, units } = resources.get();
  const collectedActions = [];

  const unitTypeData = data.getUnitTypeData(unitType);
  if (!unitTypeData || typeof unitTypeData.abilityId === 'undefined') {
    return collectedActions; // return an empty array early
  }

  const abilityId = unitTypeData.abilityId;

  if (position) {
    const unitTypes = data.findUnitTypesWithAbility(abilityId);

    if (!unitTypes.includes(UnitType.NYDUSNETWORK)) {
      if (agent.canAfford(unitType)) {
        const canPlaceOrFalse = await actions.canPlace(unitType, [position]);
        position = (canPlaceOrFalse === false && !keepPosition(world, unitType, position)) ? null : position;

        if (position) {
          // Prepare the builder for the task
          const builder = prepareBuilderForConstruction(world, unitType, position);
          if (builder) {
            collectedActions.push(...commandBuilderToConstruct(world, builder, unitType, position));
          } else {
            // No builder found. Handle the scenario or add a fallback mechanism.
          }
        } else if (position !== null) {  // Check if position is not null
          planService.pausePlan = false;
          planService.continueBuild = true;
        }
      } else {
        // When you cannot afford the structure, you might want to move the builder close to the position 
        // so it's ready when you can afford it. 
        // This logic needs to be implemented if it's the desired behavior.
      }
    } else {
      collectedActions.push(...await buildWithNydusNetwork(world, unitType, abilityId));
    }

    const [pylon] = units.getById(PYLON);
    if (pylon && typeof pylon.buildProgress !== 'undefined' && pylon.buildProgress < 1 && pylon.pos && typeof pylon.unitType !== 'undefined') {
      collectedActions.push(...premoveBuilderToPosition(world, pylon.pos, pylon.unitType, getBuilder));
      planService.pausePlan = true;
      planService.continueBuild = false;
    }
  }
  return collectedActions;
}

module.exports = {
  createMoveCommand,
  commandPlaceBuilding,
};