//@ts-check
"use strict"

const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { toDegrees, toRadians } = require("@node-sc2/core/utils/geometry/angle");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const positionService = {
  /**
   * Clamps a point to be within specified bounds.
   * @param {Point2D} point The point to clamp.
   * @param {number} minX The minimum allowable x value.
   * @param {number} maxX The maximum allowable x value.
   * @param {number} minY The minimum allowable y value.
   * @param {number} maxY The maximum allowable y value.
   * @returns {Point2D} The clamped point.
   */
  clampPointToBounds(point, minX, maxX, minY, maxY) {
    const x = point.x ?? 0;  // Using the nullish coalescing operator to provide a default value
    const y = point.y ?? 0;

    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY)
    };
  },

  /**
   * Find a nearby pathable point by adjusting the angle.
   * @param {MapResource} map
   * @param {Point2D} position
   * @param {number} oppositeAngle
   * @param {number} distance
   * @returns {Point2D | undefined}
   */
  findPathablePointByAngleAdjustment(map, position, oppositeAngle, distance) {
    const MAX_ADJUSTMENT_ANGLE = 90;  // Limit to how much we adjust the angle
    const ANGLE_INCREMENT = 10;       // Angle step

    // Handle the potential for undefined x and y values by providing defaults
    const x = position.x ?? 0;
    const y = position.y ?? 0;

    for (let i = ANGLE_INCREMENT; i <= MAX_ADJUSTMENT_ANGLE; i += ANGLE_INCREMENT) {
      // Check counter-clockwise
      let adjustedAngle1 = (oppositeAngle - i + 360) % 360;
      let point1 = {
        x: Math.cos(adjustedAngle1 * Math.PI / 180) * distance + x,
        y: Math.sin(adjustedAngle1 * Math.PI / 180) * distance + y
      };

      if (map.isPathable(point1)) {
        return point1;
      }

      // Check clockwise
      let adjustedAngle2 = (oppositeAngle + i) % 360;
      let point2 = {
        x: Math.cos(adjustedAngle2 * Math.PI / 180) * distance + x,
        y: Math.sin(adjustedAngle2 * Math.PI / 180) * distance + y
      };

      if (map.isPathable(point2)) {
        return point2;
      }
    }

    // No pathable point found within max adjustments
    return undefined;
  },
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
   * @param {Point2D[]} points
   * @param {number} eps
   * @param {number} minPts
   * @returns {Point2D[]}
   */
  getClusters(points, eps = 1.5, minPts = 1) {
    return positionService.dbscan(points, eps, minPts);
  },
  /**
   * @param {Point2D} a
   * @param {Point2D} b
   * @returns {number}
   */
  getDistanceSquared(a, b) {
    const { x: ax, y: ay } = a; if (ax === undefined || ay === undefined) return Infinity
    const { x: bx, y: by } = b; if (bx === undefined || by === undefined) return Infinity
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  },
  /**
   * Return position directly away from targetPosition based on position.
   * @param {MapResource} map
   * @param {Point2D} targetPosition 
   * @param {Point2D} position 
   * @param {number} distance 
   * @param {boolean} isFlyingUnit 
   * @returns {Point2D | undefined}
   */
  moveAwayPosition(map, targetPosition, position, distance = 2, isFlyingUnit = false) {
    const { x: targetX = null, y: targetY = null } = targetPosition;
    const { x: positionX = null, y: positionY = null } = position;

    if (targetX === null || targetY === null || positionX === null || positionY === null) {
      throw new Error("Incomplete Point2D provided");
    }

    const angle = toDegrees(Math.atan2(targetY - positionY, targetX - positionX));
    const oppositeAngle = (angle + 180) % 360;

    const awayPoint = {
      x: positionX + distance * Math.cos(toRadians(oppositeAngle)),
      y: positionY + distance * Math.sin(toRadians(oppositeAngle))
    };

    const { x: mapWidth, y: mapHeight } = map.getSize();

    if (typeof mapWidth === 'undefined' || typeof mapHeight === 'undefined') {
      // Handle this case. For instance, log an error or throw an exception.
      console.error("Map dimensions are undefined");
      return;  // or throw an exception, or handle in another way that fits your logic
    }

    const clampedPoint = positionService.clampPointToBounds(awayPoint, 0, mapWidth, 0, mapHeight);

    // Skip pathability check for flying units
    if (isFlyingUnit) {
      return clampedPoint;
    }

    return map.isPathable(clampedPoint) ? clampedPoint : positionService.findPathablePointByAngleAdjustment(map, position, oppositeAngle, distance);
  }
}

module.exports = positionService;
