// shared-functions.js
//@ts-check
"use strict"

const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getDistance } = require("../../services/position-service");
const pathFindingService = require("./pathfinding/pathfinding-service");
const MapResourceService = require("../../systems/map-resource-system/map-resource-service");

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

/**
 * Checks if a given position is on the creep.
 * @param {Point2D} position - The position to check.
 * @returns {Boolean} - True if the position is on the creep, false otherwise.
 */
function isOnCreep(position) {
  const { x, y } = position;
  if (x === undefined || y === undefined) return false;
  const grid = `${Math.floor(x)}:${Math.floor(y)}`;
  return MapResourceService.creepPositionsSet.has(grid);
}

// Export the functions
module.exports = {
  getClosestSafeMineralField,
  isOnCreep,
};
