//@ts-check
"use strict"

const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getDistance } = require("../../services/position-service");
const { pathFindingService } = require("./pathfinding");
const { getGasGeysers } = require("./unit-retrieval");
const { UnitType } = require("@node-sc2/core/constants");
const { countTypes, addOnTypesMapping } = require("../../helper/groups");

/**
 * Check if a unit type can construct an addon.
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function canUnitBuildAddOn(unitType) {
  const { BARRACKS, FACTORY, STARPORT } = UnitType;
  // Add the unit types that can construct addons here
  const addonConstructingUnits = [
    ...(countTypes.get(BARRACKS) || []), ...(addOnTypesMapping.get(BARRACKS) || []),
    ...(countTypes.get(FACTORY) || []), ...(addOnTypesMapping.get(FACTORY) || []),
    ...(countTypes.get(STARPORT) || []), ...(addOnTypesMapping.get(STARPORT) || []),
  ];
  return addonConstructingUnits.includes(unitType);
}

/**
 * Retrieves the closest pathable positions between two points, considering gas geysers.
 * @param {ResourceManager} resources - The resource manager containing map and units data.
 * @param {Point2D} position - The starting position.
 * @param {Point2D} targetPosition - The target position.
 * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}} - Closest pathable positions and related data.
 */
function getClosestPathWithGasGeysers(resources, position, targetPosition) {
  const { units } = resources.get();
  const gasGeysers = getGasGeysers(units);
  return pathFindingService.getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers);
}

/**
 * Retrieves the closest unit by path while considering gas geysers.
 * @param {ResourceManager} resources - The resource manager containing map and units data.
 * @param {Point2D} position - The starting position.
 * @param {Unit[]} units - The array of units.
 * @param {number} n - Number of units to retrieve.
 * @returns {Unit[]} - Closest units by path.
 */
function getClosestUnitConsideringGasGeysers(resources, position, units, n = 1) {
  const { units: unitResource } = resources.get();
  const gasGeysers = getGasGeysers(unitResource);
  return pathFindingService.getClosestUnitByPath(resources, position, units, gasGeysers, n);
}

/**
 * Calculate Euclidean distance between two points
 * @param {Point2D} pos1
 * @param {Point2D} pos2
 * @returns {number}
 */
function getDistanceBetween(pos1, pos2) {
  if (!pos1 || !pos2) return Infinity;

  const { x: x1, y: y1 } = pos1;
  const { x: x2, y: y2 } = pos2;

  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return Infinity;
  }

  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Gets the closest safe mineral field to the given position.
 * @param {ResourceManager} resources - The current state of resources in the game.
 * @param {Point2D} position - The starting position.
 * @param {Point2D} targetPosition - The target position.
 * @returns {Unit | undefined} - The closest safe mineral field or undefined if not found.
 */
function getClosestSafeMineralField(resources, position, targetPosition) {
  const { map, units } = resources.get();
  return map.getExpansions().reduce((/** @type {Unit | undefined} */ acc, expansion) => {
    const { areas, cluster, townhallPosition } = expansion; if (areas === undefined || cluster === undefined) return acc;
    const { mineralLine } = areas; if (mineralLine === undefined) return acc;
    const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(townhallPosition, mineralField.pos) < 14);
    const averageMineralLinePosition = avgPoints(mineralLine);
    const distancePositionToMineralLine = pathFindingService.getDistanceByPath(resources, position, averageMineralLinePosition);
    const distanceTargetToMineralLine = pathFindingService.getDistanceByPath(resources, targetPosition, averageMineralLinePosition);
    if (distancePositionToMineralLine < distanceTargetToMineralLine) {
      const [closestMineralField] = mineralFields;
      return closestMineralField;
    }
    return acc;
  }, undefined);
}

const utilityService = {
  canUnitBuildAddOn,
  getClosestPathWithGasGeysers,
  getClosestUnitConsideringGasGeysers,
  getDistanceBetween,
  getClosestSafeMineralField
};

module.exports = utilityService;