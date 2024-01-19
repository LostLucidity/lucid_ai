// @ts-check
"use strict";

// scoutingUtils.js

// Shared utility functions
const { getDistance } = require('./geometryUtils');
const MapResources = require('./core/mapResources');

/**
 * Array to keep track of mapped enemy units.
 * @type {Unit[]}
 */
const mappedEnemyUnits = [];

/**
 * Determines the location for scouting.
 * @param {World} world - The world state containing the map resource.
 * @returns {Point2D} The location for scouting.
 */
function determineScoutingLocation(world) {
  // Extract the map resource from the world state
  const mapResource = world.resources.get().map;

  // Get the enemy's main base location using the map resource
  const enemyBaseLocation = MapResources.getEnemyBaseLocation(mapResource);

  // Method to get potential expansion sites, assuming it doesn't require additional parameters
  const expansionSites = MapResources.getPotentialExpansionSites(mapResource);

  // Choose a location based on the current game situation
  return enemyBaseLocation || expansionSites[0]; // Fallback to the first expansion site if the main base location is unknown
} 

/**
 * Determines multiple locations for scouting.
 * @param {World} world - The current world state.
 * @returns {Point2D[]} An array of locations for scouting.
 */
function determineScoutingLocations(world) {
  const mapResource = world.resources.get().map;

  // Identify key areas of interest for scouting
  const enemyMainBase = mapResource.getEnemyMain()?.townhallPosition;
  const enemyNatural = mapResource.getEnemyNatural()?.townhallPosition;

  // Combine these locations into an array
  let pointsOfInterest = [];

  if (enemyMainBase) {
    pointsOfInterest.push(enemyMainBase);
  }
  if (enemyNatural) {
    pointsOfInterest.push(enemyNatural);
  }

  return pointsOfInterest;
} 

/**
 * Finds enemy units near a given unit.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} unit - The unit to check for nearby enemy units.
 * @param {number} radius - The radius to check for enemy units.
 * @returns {Unit[]} Array of enemy units near the given unit.
 */
function findEnemyUnitsNear(units, unit, radius) {
  if (!unit.pos) return [];
  const enemyUnits = Array.from(units._units[4].values()); // 4 represents Enemy

  return enemyUnits.filter(enemyUnit => {
    const distance = getDistance(unit.pos, enemyUnit.pos);
    return distance !== undefined && distance < radius;
  });
}

/**
 * Determines if a unit is suitable for scouting.
 * @param {Unit} unit - The unit to evaluate.
 * @returns {boolean} True if the unit is suitable for scouting, false otherwise.
 */
function isSuitableForScouting(unit) {
  // Ensure all checks return a boolean value, defaulting to false if undefined
  const isIdleOrFree = !!unit.noQueue && !unit.isGathering() && !unit.isConstructing();
  const isNotInCombat = !unit.isAttacking();

  return isIdleOrFree && isNotInCombat;
}

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

// Export the function(s)
module.exports = {
  mappedEnemyUnits,
  determineScoutingLocations,
  findEnemyUnitsNear,
  isSuitableForScouting,
  selectSCVForScouting,
};