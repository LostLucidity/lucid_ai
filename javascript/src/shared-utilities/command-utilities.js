// shared-utilities/command-utilities.js

/**
 * Creates a unit command action.
 * 
 * @param {AbilityId} abilityId - The ability ID for the action.
 * @param {Unit[]} units - The units to which the action applies.
 * @param {boolean} queue - Whether or not to queue the action.
 * @param {Point2D} [targetPos] - Optional target position for the action.
 * 
 * @returns {SC2APIProtocol.ActionRawUnitCommand} - The unit command action.
 */
function createUnitCommand(abilityId, units, queue = false, targetPos) {
  const unitCommand = {
    abilityId,
    unitTags: units.reduce((/** @type {string[]} */ acc, unit) => {
      if (unit.tag !== undefined) {
        acc.push(unit.tag);
      }
      return acc;
    }, []),
    queueCommand: queue,
  };

  if (targetPos) {
    unitCommand.targetWorldSpacePos = targetPos;
  }

  return unitCommand;
}

module.exports = {
  createUnitCommand
};
