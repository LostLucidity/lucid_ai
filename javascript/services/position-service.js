//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const positionService = {
  /**
   * @param {Point2D} pos
   * @param {Number} radius
   * @returns {Point2D[]}
   */
  getBorderPositions(pos, radius) {
    const positions = [];
    for (let i = 0; i < 360; i += 10) {
      const { x, y } = pos; if (x === undefined || y === undefined) { return []; }
      const angle = i * Math.PI / 180;
      const x1 = x + radius * Math.cos(angle);
      const y1 = y + radius * Math.sin(angle);
      positions.push({ x: x1, y: y1 });
    }
      return positions;
    },
  /**
   * @param {Point2D} posA
   * @param {Point2D} posB
   * @returns {number}
   */
  getDistance(posA, posB) {
    return distance(posA, posB);
  },
  /**
   * @param {Point2D} position 
   * @param {UnitTypeId} unitType
   * @returns {Point2D}
   */
  getMiddleOfStructure(position, unitType ) {
    if (gasMineTypes.includes(unitType)) return position;
    let { x, y } = position;
    if (x === undefined || y === undefined) return position;
    const footprint = getFootprint(unitType);
    if (footprint === undefined) return position;
    if (footprint.h % 2 === 1) {
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