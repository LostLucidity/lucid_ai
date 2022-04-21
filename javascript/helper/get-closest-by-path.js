//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getPathCoordinates } = require("../services/path-service");
const { getUnitCornerPosition } = require("../services/unit-service");

module.exports = {
  /**
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @param {Point2D} targetPosition 
   * @returns {number}
   */
  distanceByPath: (resources, position, targetPosition) => {
    const { map, units } = resources.get();
    try {
      targetPosition = map.isPathable(targetPosition) ? targetPosition : getUnitCornerPosition(units.getClosest(targetPosition, units.getAlive())[0]);
      const calculatedZeroPath = map.path(position, targetPosition).length === 0;
      const isZeroPathDistance = calculatedZeroPath && distance(position, targetPosition) <= 2 ? true : false;
      const isNotPathable = calculatedZeroPath && !isZeroPathDistance ? true : false;
      // get totalDistanceOfPathCoordinates by sequencially adding the distances of each coordinate
      const { totalDistance } = getPathCoordinates(map.path(position, targetPosition)).reduce((acc, curr) => {
        return {
          totalDistance: acc.totalDistance + distance(curr, acc.previousPosition),
          previousPosition: curr
        }
      }, {
        totalDistance: 0,
        previousPosition: position
      });
      const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : totalDistance;
      return pathLength;
    } catch (error) {
      return Infinity;
    }
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @param {Point2D[]} points 
   * @param {number} n 
   * @returns {Point2D[]}
   */
  getClosestPositionByPath: (resources, position, points, n = 1) => {
    return points.map(point => ({ point, distance: module.exports.distanceByPath(resources, position, point) }))
      .sort((a, b) => a.distance - b.distance)
      .map(pointObject => pointObject.point)
      .slice(0, n);
  }
}