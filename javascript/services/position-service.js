//@ts-check
"use strict"

const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const positionService = {

  /**
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @returns {Point2D}
   */
  getMiddleOfStructure(position, unitType ) {
    let { x, y } = position;
    if (getFootprint(unitType).h % 2 === 1) {
      x += 0.5;
      y += 0.5;
    }
    return { x, y };
  },
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