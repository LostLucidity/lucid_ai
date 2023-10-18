/**
 * This service handles the creation of unit commands.
 */

const { Ability } = require("@node-sc2/core/constants");

/**
 * Creates a command to move a unit to a specified position.
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

module.exports = {
  createMoveCommand,
};
