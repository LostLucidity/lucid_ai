//@ts-check
"use strict"

const actionsService = {
  /**
   * 
   * @param {AbilityId} abilityId 
   * @param {Unit[]} units 
   * @param {boolean} queue 
   * @returns {SC2APIProtocol.ActionRawUnitCommand}
   */
  createUnitCommand: (abilityId, units, queue = false) => {
    const unitCommand = {
      abilityId,
      unitTags: units.map(unit => unit.tag),
      queueCommand: queue,
    };
    return unitCommand;
  },
}
module.exports = actionsService;