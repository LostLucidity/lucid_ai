//@ts-check
"use strict"


// src/geometryUtils.js

/**
 * Calculate the Euclidean distance between two points.
 * Returns a large number if either point is undefined.
 * 
 * @param {SC2APIProtocol.Point | undefined} point1
 * @param {SC2APIProtocol.Point | undefined} point2
 * @returns {number} The distance, or a large number if either point is undefined.
 */
function getDistance(point1, point2) {
  if (point1 && point2 && typeof point1.x === 'number' && typeof point1.y === 'number' && typeof point2.x === 'number' && typeof point2.y === 'number') {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return Number.MAX_VALUE; // Return a very large number to signify an undefined or unmeasurable distance
}

module.exports = {
  getDistance
};