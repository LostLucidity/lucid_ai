// scoutActions.js
const { selectSCVForScouting } = require("./scoutManager");
const { determineScoutingLocations } = require("../../utils/scouting/scoutingUtils");
const { createMoveCommand } = require("../../utils/unit/unitCommands");

/**
 * Performs the action of scouting with an SCV.
 * @param {World} world - The current world state.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions representing the scouting task.
 */
function performScoutingWithSCV(world) {
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  let actions = [];
  const scvId = selectSCVForScouting(world);

  // Determine multiple scouting locations
  const scoutingLocations = determineScoutingLocations(world);

  // Create move commands for the SCV to scout each location
  scoutingLocations.forEach(location => {
    const moveCommand = createMoveCommand(scvId, location);
    actions.push(moveCommand);
  });

  return actions;
}

module.exports = { performScoutingWithSCV };
