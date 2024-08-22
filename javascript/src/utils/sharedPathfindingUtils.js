// src/utils/sharedPathfindingUtils.js

const { getClosestPathablePositionsBetweenPositions } = require("../core/pathfindingCore");
const { getGasGeysers } = require("../features/shared/pathfinding/pathfinding");

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
  return getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers);
}

module.exports = {
  getClosestPathWithGasGeysers
};
