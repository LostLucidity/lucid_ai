// scouting.js

const { determineScoutingLocation, isSuitableForScouting, determineScoutingLocations } = require("./scoutingUtils");
const { createMoveCommand } = require("../unit/unitCommands");

/**
 * Selects an SCV unit for scouting.
 * @param {World} world - The current world state.
 * @returns {number} The ID of the selected SCV.
 */
function selectSCVForScouting(world) {
  const SCV_TYPE_ID = 45; // Constant ID for an SCV
  const units = world.resources.get().units; // Accessing the units resource

  const scoutingLocation = determineScoutingLocation(world);

  let [selectedScv] = units.getClosest(
    scoutingLocation,
    units.getById(SCV_TYPE_ID).filter(unit => isSuitableForScouting(unit))
  );

  // Check if a suitable SCV is found and return its ID
  if (selectedScv && selectedScv.tag) {
    // Assuming tag is a string that can be parsed to a number
    return parseInt(selectedScv.tag);
  }

  // Return a consistent fallback value if no suitable SCV is found
  return -1;
}

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

module.exports = {
  performScoutingWithSCV,
};
