const { performScoutingWithSCV } = require("../../../gameLogic/scouting/scoutActions");

/**
 * Executes the specified special action.
 * @param {string} specialAction - The action to execute.
 * @param {World} world - The current world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function executeSpecialAction(specialAction, world) {
  switch (specialAction) {
    case 'Scouting with SCV':
      return performScoutingWithSCV(world);
    default:
      console.warn(`Unhandled special action: ${specialAction}`);
      return [];
  }
}  


module.exports = {
  executeSpecialAction
};
