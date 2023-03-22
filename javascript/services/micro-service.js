//@ts-check
"use strict"

const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");

const microService = {
  /**
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} degrees
   * @returns {boolean}
   */
  isFacing: (unit, targetUnit, degrees=40) => {
    const targetFacingDegrees = toDegrees(unit.facing);
    const { pos } = unit; if (pos === undefined) { return false; }
    const { pos: targetPos } = targetUnit; if (targetPos === undefined) { return false; }
    const { x, y } = pos; if (x === undefined || y === undefined) { return false; }
    const { x: targetX, y: targetY } = targetPos; if (targetX === undefined || targetY === undefined) { return false; }
    const positionOfUnitDegrees = toDegrees(Math.atan2(targetY - y, targetX - x));
    // facing difference is difference of 0 or 360 degrees
    const facingDifference = Math.abs(targetFacingDegrees - positionOfUnitDegrees);
    const facingDifference2 = Math.abs(targetFacingDegrees - positionOfUnitDegrees + 360);
    const facingDifference3 = Math.abs(targetFacingDegrees - positionOfUnitDegrees - 360);
    const facingDifferenceMin = Math.min(facingDifference, facingDifference2, facingDifference3);
    return facingDifferenceMin < degrees;
  },
}

module.exports = microService;