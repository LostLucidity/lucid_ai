//@ts-check
"use strict"

const { add, distance } = require("@node-sc2/core/utils/geometry/point");

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
      targetPosition = map.isPathable(targetPosition) ? targetPosition : getUnitCornerPosition(units.getClosest(position, units.getAlive())[0]);
      const calculatedZeroPath = map.path(position, targetPosition).length === 0;
      const isZeroPathDistance = calculatedZeroPath && distance(position, targetPosition) <= 2 ? true : false;
      const isNotPathable = calculatedZeroPath && !isZeroPathDistance ? true : false;
      const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : map.path(position, targetPosition).length;
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
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @param {Unit[]} units 
   * @param {number} n 
   * @returns {Unit[]}
   */
  getClosestUnitByPath: (resources, position, units, n = 1) => {
    return units.map(unit => ({ unit, distance: module.exports.distanceByPath(resources, add(unit.pos, unit.radius), position) }))
      .sort((a, b) => a.distance - b.distance)
      .map(u => u.unit)
      .slice(0, n);
  }
}

function getUnitCornerPosition(unit) {
  return add(unit.pos, unit.radius);
}