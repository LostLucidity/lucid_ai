// src/utils.js

/**
 * Calculates the distance between two points.
 * @param {Point} pointA - First point.
 * @param {Point} pointB - Second point.
 * @returns {number} - The distance between the two points.
 */
function calculateDistance(pointA, pointB) {
  return Math.sqrt(Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2));
}

module.exports = {
  calculateDistance,
};
