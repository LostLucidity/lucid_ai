// src/utils/pathfindingCore.js

const { Alliance } = require("@node-sc2/core/constants/enums");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");

const cacheManager = require("./cache");
const { getStructureCells, getPathablePositions, checkIfPositionIsCorner, getPathCoordinates, getMapPath, getClosestPosition } = require("../features/shared/pathfindingCommon");
const { getDistanceByPath } = require("../features/shared/pathfindingCore");

/**
 * Get the closest pathable positions between two positions considering various obstacles.
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {Point2D} targetPosition
 * @param {Unit[]} gasGeysers
 * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}}
 */
function getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers = []) {
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
        distance: getDistanceByPath(resources, pathablePosition, pathableTargetPosition)
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
 * Retrieves gas geyser units from the unit resource.
 * Uses a cache to store and return the gas geysers.
 * @param {UnitResource} units - The unit resource object from the bot.
 * @returns {Unit[]}
 */
function getGasGeysers(units) {
  const cacheKey = 'gasGeysers';
  let gasGeysers = cacheManager.getGasGeysersCache(cacheKey);

  if (!gasGeysers) {
    gasGeysers = units.getGasGeysers();
    cacheManager.setGasGeysersCache(cacheKey, gasGeysers);
  }

  return gasGeysers;
}

module.exports = {
  getClosestPathablePositionsBetweenPositions,
  getGasGeysers
};
