//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getStructureCells, getDistance } = require("../../../services/position-service");
const { getPathablePositions, getMapPath, getClosestPathablePositions } = require("../../../systems/map-resource-system/map-resource-service");
const { getPathCoordinates } = require("../../../services/path-service");
const { avgPoints, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../../helper/get-closest");
const { isOnCreep } = require("../shared-utilities/common-utilities");

/**
 * Service for handling pathfinding and movement related logic.
 */
class PathfindingService {
  constructor() {
    // No need to inject dependency in constructor
  }

  /** 
  * 
  * @param {MapResource} map 
  * @param {Point2D} pos 
  * @returns {Boolean}
  */
  isCreepEdge(map, pos) {
    const { x, y } = pos;

    if (x === undefined || y === undefined) return false;

    /** 
     * @param {number} x 
     * @param {number} y 
     * @param {SC2APIProtocol.Size2DI} mapSize 
     */
    const isWithinMap = (x, y, mapSize) =>
      mapSize.x !== undefined && mapSize.y !== undefined &&
      x >= 0 && x < mapSize.x && y >= 0 && y < mapSize.y;

    const mapSize = map.getSize();

    // Verify position is valid and within map
    if (!isWithinMap(x, y, mapSize)) return false;

    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    const checkNeighbors = (x, y) => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          // Skip the center point
          if (dx === 0 && dy === 0) continue;

          const neighborX = x + dx;
          const neighborY = y + dy;

          // Check if the neighbor is within map boundaries
          if (!isWithinMap(neighborX, neighborY, mapSize)) continue;

          const neighbor = { x: neighborX, y: neighborY };

          // Check the condition and return early if satisfied
          if (!map.hasCreep(neighbor) && map.isPathable(neighbor)) {
            return true;
          }
        }
      }
      return false;
    }

    return isOnCreep(pos) && checkNeighbors(x, y);
  }

  /**
   * Get the closest pathable positions between two positions considering various obstacles.
   * @param {ResourceManager} resources
   * @param {Point2D} position
   * @param {Point2D} targetPosition
   * @param {Unit[]} gasGeysers
   * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}}
   */
  getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers=[]) {
    const { map, units } = resources.get();
    const mapFixturesToCheck = [
      ...units.getStructures({ alliance: Alliance.SELF }),
      ...units.getStructures({ alliance: Alliance.ENEMY }),
      ...gasGeysers,
    ];

    const structureAtPositionCells = getStructureCells(position, mapFixturesToCheck);
    const structureAtTargetPositionCells = getStructureCells(targetPosition, mapFixturesToCheck);

    // Store the original state of each cell
    const originalCellStates = new Map();
    [...structureAtPositionCells, ...structureAtTargetPositionCells].forEach(cell => {
      originalCellStates.set(cell, map.isPathable(cell));
      map.setPathable(cell, true);
    });

    const pathablePositions = getPathablePositions(map, position);
    const isAnyPositionCorner = checkIfPositionIsCorner(pathablePositions, position);
    const filteredPathablePositions = isAnyPositionCorner && pathablePositions.length === 4
      ? pathablePositions.filter(pos => {
        const { x, y } = pos;
        if (x === undefined || y === undefined) return false;
        const { x: centerX, y: centerY } = position;
        if (centerX === undefined || centerY === undefined) return false;
        return (x > centerX && y > centerY) || (x < centerX && y < centerY);
      })
      : pathablePositions;
    const pathableTargetPositions = getPathablePositions(map, targetPosition);
    const isAnyTargetPositionCorner = checkIfPositionIsCorner(pathableTargetPositions, targetPosition);
    const filteredPathableTargetPositions = isAnyTargetPositionCorner && pathableTargetPositions.length === 4
      ? pathableTargetPositions.filter(pos => {
        const { x, y } = pos;
        if (x === undefined || y === undefined) return false;
        const { x: centerX, y: centerY } = targetPosition;
        if (centerX === undefined || centerY === undefined) return false;
        return (x > centerX && y > centerY) || (x < centerX && y < centerY);
      })
      : pathableTargetPositions;
    const distancesAndPositions = filteredPathablePositions.map(pathablePosition => {
      const distancesToTargetPositions = filteredPathableTargetPositions.map(pathableTargetPosition => {
        return {
          pathablePosition,
          pathableTargetPosition,
          pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
          distance: this.getDistanceByPath(resources, pathablePosition, pathableTargetPosition)
        };
      });
      if (isAnyPositionCorner || isAnyTargetPositionCorner) {
        const averageDistance = distancesToTargetPositions.reduce((acc, { distance }) => acc + distance, 0) / distancesToTargetPositions.length;
        return {
          pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, targetPosition)),
          pathablePosition,
          pathableTargetPosition: targetPosition,
          distance: averageDistance
        };
      } else {
        return distancesToTargetPositions.reduce((acc, curr) => acc.distance < curr.distance ? acc : curr);
      }
    }).sort((a, b) => a.distance - b.distance);
    let result;
    if (isAnyPositionCorner || isAnyTargetPositionCorner) {
      const averageDistance = distancesAndPositions.reduce((acc, curr) => {
        return acc + curr.distance;
      }, 0) / distancesAndPositions.length;
      const pathablePosition = isAnyPositionCorner ? avgPoints(filteredPathablePositions) : getClosestPosition(position, filteredPathablePositions)[0];
      const pathableTargetPosition = isAnyTargetPositionCorner ? avgPoints(filteredPathableTargetPositions) : getClosestPosition(targetPosition, filteredPathableTargetPositions)[0];
      result = {
        pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
        pathablePosition,
        pathableTargetPosition,
        distance: averageDistance
      };
    } else {
      result = distancesAndPositions[0];
    }

    // Restore each cell to its original state
    [...structureAtPositionCells, ...structureAtTargetPositionCells].forEach(cell => {
      const originalState = originalCellStates.get(cell);
      map.setPathable(cell, originalState);
    });

    // return the result after restoring unpathable cells
    return result;
  }

  /**
   * 
   * @param {ResourceManager} resources 
   * @param {Point2D} position 
   * @param {Point2D[]} points
   * @param {number} n
   * @returns {Point2D[]}
   */
  getClosestPositionByPath(resources, position, points, n = 1) {
    return points.map(point => ({ point, distance: this.getDistanceByPath(resources, position, point) }))
      .sort((a, b) => a.distance - b.distance)
      .map(pointObject => pointObject.point)
      .slice(0, n);
  }

  /**
   *
   * @param {ResourceManager} resources
   * @param {Point2D|SC2APIProtocol.Point} position
   * @param {Unit[]} units
   * @param {Unit[]} gasGeysers
   * @param {number} n
   * @returns {Unit[]}
   */
  getClosestUnitByPath(resources, position, units, gasGeysers=[], n = 1) {
    const { map } = resources.get();

    const splitUnits = units.reduce((/** @type {{within16: Unit[], outside16: Unit[]}} */acc, unit) => {
      const { pos } = unit; if (pos === undefined) return acc;
      const distanceToUnit = getDistance(pos, position);
      const pathablePosData = this.getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
      const distanceByPath = this.getDistanceByPath(resources, pathablePosData.pathablePosition, pathablePosData.pathableTargetPosition);
      const isWithin16 = distanceToUnit <= 16 && distanceByPath <= 16;
      return {
        within16: isWithin16 ? [...acc.within16, unit] : acc.within16,
        outside16: isWithin16 ? acc.outside16 : [...acc.outside16, unit]
      };
    }, { within16: [], outside16: [] });

    let closestUnits = splitUnits.within16.sort((a, b) => {
      const { pos } = a; if (pos === undefined) return 1;
      const { pos: bPos } = b; if (bPos === undefined) return -1;
      const aData = this.getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
      const bData = this.getClosestPathablePositionsBetweenPositions(resources, bPos, position, gasGeysers);
      return this.getDistanceByPath(resources, aData.pathablePosition, aData.pathableTargetPosition) - this.getDistanceByPath(resources, bData.pathablePosition, bData.pathableTargetPosition);
    });

    if (n === 1 && closestUnits.length > 0) return closestUnits;

    const unitsByDistance = [...closestUnits, ...splitUnits.outside16].reduce((/** @type {{unit: Unit, distance: number}[]} */acc, unit) => {
      const { pos } = unit;
      if (pos === undefined) return acc;

      const expansionWithin16 = map.getExpansions().find(expansion => {
        const { centroid: expansionPos } = expansion;
        if (expansionPos === undefined) return;
        return getDistance(expansionPos, pos) <= 16 && this.getClosestPathablePositionsBetweenPositions(resources, expansionPos, pos, gasGeysers).distance <= 16;
      });

      const targetPosition = expansionWithin16 ? expansionWithin16.centroid : pos; if (targetPosition === undefined) return acc;
      const closestPathablePositionBetweenPositions = this.getClosestPathablePositionsBetweenPositions(resources, targetPosition, position, gasGeysers);
      return [...acc, { unit, distance: closestPathablePositionBetweenPositions.distance }];
    }, []).sort((a, b) => {
      if (a === undefined) return 1;
      if (b === undefined) return -1;
      return a.distance - b.distance;
    });

    return unitsByDistance.slice(0, n).map(u => u.unit);
  }

  /**
  * @param {ResourceManager} resources
  * @param {Point2D} position
  * @param {Point2D|SC2APIProtocol.Point} targetPosition
  * @returns {number}
  */
  getDistanceByPath(resources, position, targetPosition) {
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
        return getDistance(position, targetPosition);
      } else {
        let path = getMapPath(map, position, targetPosition);
        const pathCoordinates = getPathCoordinates(path);

        let straightLineSegments = [];
        let currentSegmentStart = pathCoordinates[0];

        for (let i = 1; i < pathCoordinates.length; i++) {
          const point = pathCoordinates[i];
          const segment = [currentSegmentStart, point];

          // If the segment is not a straight line that the unit can traverse,
          // add the previous straight line segment to the list and start a new one
          if (!isLineTraversable(map, segment)) {
            straightLineSegments.push([currentSegmentStart, pathCoordinates[i - 1]]);
            currentSegmentStart = pathCoordinates[i - 1];
          }
        }

        // Add the last straight line segment
        straightLineSegments.push([currentSegmentStart, pathCoordinates[pathCoordinates.length - 1]]);

        // Now calculate the sum of distances of the straight line segments
        distance = straightLineSegments.reduce((acc, segment) => {
          return acc + getDistance(segment[0], segment[1]);
        }, 0);

        const calculatedZeroPath = path.length === 0;
        const isZeroPathDistance = calculatedZeroPath && getDistance(position, targetPosition) <= 2 ? true : false;
        const isNotPathable = calculatedZeroPath && !isZeroPathDistance ? true : false;
        const pathLength = isZeroPathDistance ? 0 : isNotPathable ? Infinity : distance;
        return pathLength;
      }
    } catch (error) {
      return Infinity;
    }
  }
}

module.exports = new PathfindingService();

/**
 * @param {Point2D[]} positions 
 * @param {Point2D} position 
 * @returns {Boolean}
 */
function checkIfPositionIsCorner(positions, position) {
  return positions.some(pos => {
    const { x, y } = position;
    const { x: pathableX, y: pathableY } = pos;
    if (x === undefined || y === undefined || pathableX === undefined || pathableY === undefined) { return false; }
    const halfway = Math.abs(x - pathableX) === 0.5 || Math.abs(y - pathableY) === 0.5;
    return halfway && getDistance(position, pos) <= 1;
  });
}

/**
 * @param {Point2D} start 
 * @param {Point2D} end 
 * @param {Number} steps
 * @returns  {Point2D[]}
 */
function getLine(start, end, steps = 0) {
  const points = [];
  if (areEqual(start, end)) return [start];
  const { x: startX, y: startY } = start;
  const { x: endX, y: endY } = end;
  if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) return [start];
  const dx = endX - startX;
  const dy = endY - startY;
  steps = steps === 0 ? Math.max(Math.abs(dx), Math.abs(dy)) : steps;
  for (let i = 0; i < steps; i++) {
    const x = startX + (dx / steps) * i;
    const y = startY + (dy / steps) * i;
    points.push({ x, y });
  }
  return points;
}

/**
 * @param {MapResource} map
 * @param {Point2D[]} line - An array containing two points that define a straight line segment.
 * @returns {boolean}
 */
function isLineTraversable(map, line) {
  const [start, end] = line;
  const { x: startX, y: startY } = start; if (startX === undefined || startY === undefined) return false;
  const { x: endX, y: endY } = end; if (endX === undefined || endY === undefined) return false;
  const distance = getDistance(start, end);

  // Assume the unit width is 1
  const unitWidth = 1;

  // Calculate the number of points to check along the line, spaced at unit-width intervals
  const numPoints = Math.ceil(distance / unitWidth);

  // For each point along the line segment
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;  // The fraction of the way from the start point to the end point

    // Calculate the coordinates of the point
    const x = startX + t * (endX - startX);
    const y = startY + t * (endY - startY);
    const point = { x, y };

    // If the point is not on walkable terrain, return false
    if (!map.isPathable(point)) {
      return false;
    }
  }

  // If all points along the line are on walkable terrain, return true
  return true;
}