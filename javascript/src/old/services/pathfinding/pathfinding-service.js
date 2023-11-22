//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getStructureCells, getDistance } = require("../../../services/position-service");
const { getPathablePositions, getMapPath, getClosestPathablePositions } = require("../../../systems/map-resource-system/map-resource-service");
const { getPathCoordinates } = require("../../../services/path-service");
const { avgPoints, areEqual } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../../helper/get-closest");
const { isOnCreep } = require("../../shared-utilities/common-utilities");

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