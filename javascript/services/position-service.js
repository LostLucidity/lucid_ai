//@ts-check
"use strict"

const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");

const positionService = {
  /**
   * return position directly away from targetPosition based on position
   * @param {Point2D} targetPosition 
   * @param {Point2D} position 
   * @param {number} distance 
   * @returns {Point2D}
 */
  moveAwayPosition(targetPosition, position, distance = 2) {
    const angle = toDegrees(Math.atan2(targetPosition.y - position.y, targetPosition.x - position.x));
    const oppositeAngle = angle + 180 % 360;
    const awayPoint = {
      x: Math.cos(oppositeAngle * Math.PI / 180) * distance + position.x,
      y: Math.sin(oppositeAngle * Math.PI / 180) * distance + position.y
    }
    return awayPoint;
  },
}

module.exports = positionService;