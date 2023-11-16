//@ts-check
"use strict";

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {number}
 */
function dotVectors(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0);
}

/**
 * @description Returns projected position of unit.
 * @param {Point2D} pos
 * @param {Point2D} pos1
 * @param {number} time
 * @param {number} time1
 * @param {number} [stepSize=8]
 * @returns {Point2D}
 */
function getProjectedPosition(pos, pos1, time, time1, stepSize = 8) {
  const { x, y } = pos; if (x === undefined || y === undefined) return pos;
  const { x: x1, y: y1 } = pos1; if (x1 === undefined || y1 === undefined) return pos;
  const timeDiff = time1 - time;
  if (timeDiff === 0) return pos;
  const adjustedTimeDiff = timeDiff / stepSize;
  const xDiff = x1 - x;
  const yDiff = y1 - y;
  const projectedPosition = {
    x: x + xDiff / adjustedTimeDiff,
    y: y + yDiff / adjustedTimeDiff,
  };
  return projectedPosition;
}

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {Point2D}
 */
function subtractVectors(a, b) {
  return {
    x: (a.x || 0) - (b.x || 0),
    y: (a.y || 0) - (b.y || 0)
  };
}

module.exports = {
  dotVectors,
  getProjectedPosition,
  subtractVectors
};