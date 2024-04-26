// @ts-check
"use strict";

// scoutingUtils.js

// Shared utility functions
const MapResources = require('../../core/gameState/mapResources');
const { isMining } = require('../economy/workerService');
const { getDistance } = require('../spatial/spatialCoreUtils');

/**
 * Array to keep track of mapped enemy units.
 * @type {Unit[]}
 */
const mappedEnemyUnits = [];

/**
 * Determines the location for scouting based on enemy base location or potential expansion sites.
 * @param {World} world - The world state containing the map resource.
 * @returns {Point2D} The location for scouting.
 */
function determineScoutingLocation(world) {
  const mapResource = getMapResource(world);
  const { enemyMainBase, expansionSites } = getKeyLocations(mapResource);

  return enemyMainBase || expansionSites[0];
} 

/**
 * Determines multiple locations for scouting, focusing on key enemy locations.
 * @param {World} world - The current world state.
 * @returns {Point2D[]} An array of locations for scouting.
 */
function determineScoutingLocations(world) {
  const mapResource = getMapResource(world);
  const { enemyMainBase, enemyNatural } = getKeyLocations(mapResource);

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
 * Finds enemy units near a given unit within a specified radius.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} unit - The unit to check for nearby enemy units.
 * @param {number} radius - The radius to check for enemy units.
 * @returns {Unit[]} Array of enemy units near the given unit.
 */
function findEnemyUnitsNear(units, unit, radius) {
  if (!unit.pos) return [];
  const enemyUnits = Array.from(units._units[4].values());

  return enemyUnits.filter(enemyUnit => {
    const distance = getDistance(unit.pos, enemyUnit.pos);
    return distance !== undefined && distance < radius;
  });
}

/**
 * Retrieves key locations such as enemy base and natural from the map resource.
 * @param {MapResource} mapResource - The map resource object.
 * @returns {{enemyMainBase: Point2D?, enemyNatural: Point2D?, expansionSites: Point2D[]}} An object containing key locations.
 */
function getKeyLocations(mapResource) {
  return {
    enemyMainBase: mapResource.getEnemyMain()?.townhallPosition,
    enemyNatural: mapResource.getEnemyNatural()?.townhallPosition,
    expansionSites: MapResources.getPotentialExpansionSites(mapResource)
  };
}

/**
 * Retrieves the map resource object from the world state.
 * @param {World} world - The world state containing map resources.
 * @returns {MapResource} The map resource object.
 */
function getMapResource(world) {
  return world.resources.get().map;
}

/**
 * Checks if an SCV is currently assigned to scouting duties.
 * @param {Unit} unit - The SCV to check.
 * @returns {boolean} True if the SCV is assigned to scouting, false otherwise.
 */
function isScvAssignedToScouting(unit) {
  return unit.hasLabel('scouting');
}

/**
 * Determines if a unit is suitable for scouting based on its current activities.
 * @param {UnitResource} units - The units resource service to check active mining.
 * @param {Unit} unit - The unit to evaluate.
 * @returns {boolean} True if the unit is suitable for scouting, false otherwise.
 */
function isSuitableForScouting(units, unit) {
  if (unit.isConstructing() || unit.isReturning('minerals') || unit.isReturning('vespene') || isScvAssignedToScouting(unit)) {
    return false;
  }

  if (unit.isAttacking()) {
    return false;
  }

  return !isMining(units, unit);
}

// Export the function(s)
module.exports = {
  mappedEnemyUnits,
  determineScoutingLocation,
  determineScoutingLocations,
  findEnemyUnitsNear,
  isSuitableForScouting,
};