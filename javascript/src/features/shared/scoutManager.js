const { determineScoutingLocation, isSuitableForScouting } = require("./scoutingUtils");

/** @type {string | null} */
let activeScoutTag = null;

/**
 * Handles checking and updating the status of the active scout.
 * @param {World} world - The current world state.
 * @returns {boolean} True if there is an active scout, false otherwise.
 */
function handleActiveScout(world) {
  if (activeScoutTag === null) {
    return false; // No active scout, allow selection of a new scout
  }

  let currentScout = world.resources.get().units.getByTag(activeScoutTag);
  if (!currentScout || !currentScout.hasLabel('scouting')) {
    activeScoutTag = null; // Clear the active scout tag if no longer scouting
    return false; // No active scout, allow selection of a new scout
  }

  return true; // Active scout is still valid, no need to select another
}

/**
 * Selects an SCV unit for scouting if there is no active scout currently.
 * @param {World} world - The current world state.
 * @returns {number} The ID of the selected SCV.
 */
function selectSCVForScouting(world) {
  if (handleActiveScout(world)) {
    return -1; // If there's an active scout, exit the function early
  }

  const SCV_TYPE_ID = 45;
  const units = world.resources.get().units;
  const scoutingLocation = determineScoutingLocation(world);
  const availableScvs = units.getById(SCV_TYPE_ID).filter(unit => isSuitableForScouting(units, unit));

  let [selectedScv] = units.getClosest(scoutingLocation, availableScvs);
  if (selectedScv && selectedScv.tag) {
    selectedScv.addLabel('scouting', true);
    activeScoutTag = selectedScv.tag;
    return parseInt(selectedScv.tag, 10);
  }

  return -1;
}

module.exports = {
  selectSCVForScouting,
  handleActiveScout,
  /**
   * Sets the active scout tag.
   * @param {string} tag - The tag of the active scout.
   */
  setActiveScoutTag: (tag) => { activeScoutTag = tag; },
  /**
   * Gets the active scout tag.
   * @returns {string | null} The tag of the active scout.
   */
  getActiveScoutTag: () => activeScoutTag
};
