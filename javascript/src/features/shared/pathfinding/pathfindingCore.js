// src/gameLogic/spatial/pathfindingCore.js
"use strict";

const { getMapPath, getPathCoordinates } = require("./pathfindingCommonUtils");
const { getDistance } = require("./spatialCoreUtils");
const { getLine, getClosestPathablePositions, isLineTraversable } = require("../../../utils/common");

/**
  * @param {ResourceManager} resources
  * @param {Point2D} position
  * @param {Point2D|SC2APIProtocol.Point} targetPosition
  * @returns {number}
  */
function getDistanceByPath(resources, position, targetPosition) {
  const { map } = resources.get();
  try {
    const line = getLine(position, targetPosition);
    let distance = 0;
    const everyLineIsPathable = line.every((point, index) => {
      if (index > 0) {
        const previousPoint = line[index - 1];
        const heightDifference = map.getHeight(point) - map.getHeight(previousPoint);
        return Math.abs(heightDifference) <= 1;
      }
      const [closestPathablePosition] = getClosestPathablePositions(map, point);
      return closestPathablePosition !== undefined && map.isPathable(closestPathablePosition);
    });
    if (everyLineIsPathable) {
      return getDistance(position, targetPosition) || 0;
    } else {
      let path = getMapPath(map, position, targetPosition);
      const pathCoordinates = getPathCoordinates(path);

      let straightLineSegments = [];
      let currentSegmentStart = pathCoordinates[0];

      for (let i = 1; i < pathCoordinates.length; i++) {
        const point = pathCoordinates[i];
        const previousPoint = pathCoordinates[i - 1];

        // Corrected usage of isLineTraversable with required three arguments
        if (!isLineTraversable(map, previousPoint, point)) {
          straightLineSegments.push([currentSegmentStart, previousPoint]);
          currentSegmentStart = point;
        }
      }

      straightLineSegments.push([currentSegmentStart, pathCoordinates[pathCoordinates.length - 1]]);

      distance = straightLineSegments.reduce((acc, segment) => {
        const segmentDistance = getDistance(segment[0], segment[1]) || 0;
        return acc + segmentDistance;
      }, 0);

      const calculatedZeroPath = path.length === 0;
      const zeroPathDistance = calculatedZeroPath ? getDistance(position, targetPosition) || 0 : 0;
      const isZeroPathDistance = calculatedZeroPath && zeroPathDistance <= 2;
      const isNotPathable = calculatedZeroPath && !isZeroPathDistance;
      const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : distance;
      return pathLength;
    }
  } catch (error) {
    return Infinity;
  }
}

/**
 * 
 * @param {ResourceManager} resources 
 * @param {Point2D} position 
 * @param {Point2D[]} points
 * @param {number} n
 * @returns {Point2D[]}
 */
function getClosestPositionByPath(resources, position, points, n = 1) {
  return points.map(point => ({ point, distance: getDistanceByPath(resources, position, point) }))
    .sort((a, b) => a.distance - b.distance)
    .map(pointObject => pointObject.point)
    .slice(0, n);
}

module.exports = {
  getDistanceByPath,
  getClosestPositionByPath,
};
