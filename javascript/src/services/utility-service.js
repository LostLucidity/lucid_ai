//@ts-check
"use strict"

const { pathFindingService } = require("./pathfinding");
const { getGasGeysers } = require("./unit-retrieval");

const utilityService = {
  /**
   * Retrieves the closest pathable positions between two points, considering gas geysers.
   * @param {ResourceManager} resources - The resource manager containing map and units data.
   * @param {Point2D} position - The starting position.
   * @param {Point2D} targetPosition - The target position.
   * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}} - Closest pathable positions and related data.
   */
  getClosestPathWithGasGeysers: (resources, position, targetPosition) => {
    const { units } = resources.get();
    const gasGeysers = getGasGeysers(units);
    return pathFindingService.getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers);
  },
  /**
   * Retrieves the closest unit by path while considering gas geysers.
   * @param {ResourceManager} resources - The resource manager containing map and units data.
   * @param {Point2D} position - The starting position.
   * @param {Unit[]} units - The array of units.
   * @param {number} n - Number of units to retrieve.
   * @returns {Unit[]} - Closest units by path.
   */
  getClosestUnitConsideringGasGeysers: (resources, position, units, n = 1) => {
    const { units: unitResource } = resources.get();
    const gasGeysers = getGasGeysers(unitResource);
    return pathFindingService.getClosestUnitByPath(resources, position, units, gasGeysers, n);
  },
  /**
   * Calculate Euclidean distance between two points
   * @param {Point2D} pos1
   * @param {Point2D} pos2
   * @returns {number}
   */
  getDistanceBetween: (pos1, pos2) => {
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
};

module.exports = utilityService;  // Export the utility service object