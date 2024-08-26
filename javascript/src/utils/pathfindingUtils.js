// src/core/utils/pathfindingUtils.js
"use strict";

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { getNeighbors, distance } = require("@node-sc2/core/utils/geometry/point");

const cacheManager = require("../core/cache");
const { getPathablePositionsForStructure } = require("../core/common");
const { getClosestUnitByPath, existsInMap } = require("../features/shared/pathfinding/pathfinding");
const { getPathablePositions, getMapPath, getPathCoordinates, getClosestPosition } = require("../features/shared/pathfinding/pathfindingCommonUtils");
const { getClosestPathWithGasGeysers } = require("../gameLogic/economy/workerService");

/**
 * 
 * @param {{path: Point2D[], pathLength: number}[]} candidateWalls 
 * @param {Point2D[]} wallCandidate 
 * @returns 
 */
function areCandidateWallEndsUnique(candidateWalls, wallCandidate) {
  return !candidateWalls.some(candidateWall => {
    const [firstElement, lastElement] = [candidateWall.path[0], candidateWall.path[candidateWall.path.length - 1]];
    const [firstElementTwo, lastElementTwo] = [wallCandidate[0], wallCandidate[wallCandidate.length - 1]];
    const firstElementExists = firstElement.x === firstElementTwo.x && firstElement.y === firstElementTwo.y;
    const lastElementExists = lastElement.x === lastElementTwo.x && lastElement.y === lastElementTwo.y;
    return firstElementExists && lastElementExists;
  });
}

/**
 * Retrieves pathable positions from start to target, ensuring the closest base and paths are found.
 * @param {ResourceManager} resources
 * @param {Point2D} startPos
 * @param {Point2D} targetPos
 * @returns {{ closestBaseByPath: Unit, pathCoordinates: Point2D[], pathableTargetPosition: Point2D }}
 */
function calculatePathablePositions(resources, startPos, targetPos) {
  const pathableInfo = getClosestPathWithGasGeysers(resources, startPos, targetPos);
  // Ensure we always have an array, use an empty array as a fallback
  const basesWithProgress = cacheManager.getCompletedBases() || [];

  // Pass the (possibly empty) array to getClosestBaseByPath
  const closestBaseByPath = getClosestBaseByPath(resources, pathableInfo.pathableTargetPosition, basesWithProgress);

  return {
    closestBaseByPath,
    pathCoordinates: pathableInfo.pathCoordinates,
    pathableTargetPosition: pathableInfo.pathableTargetPosition
  };
}

/**
 * Finds and returns the closest pathable positions for a base and a target position within the game map.
 * If the base position is undefined, it will handle the error by returning undefined positions.
 * @param {World} world - The game world containing all data and state.
 * @param {Unit} base - The base unit from which the positions are to be pathed. The position may be undefined.
 * @param {Point2D} targetPosition - The target position to check for pathability.
 * @returns {{pathableBasePosition: Point2D | undefined, pathableTargetPosition: Point2D | undefined}} - The closest pathable positions for both base and target, or undefined if base position is not available.
 */
function findPathablePositions(world, base, targetPosition) {
  const { map } = world.resources.get();
  if (!base.pos) {
    console.error("Base position is undefined, cannot determine pathable positions.");
    return { pathableBasePosition: undefined, pathableTargetPosition: undefined };
  }

  // Generate unique cache keys for base and target positions
  const baseCacheKey = `basePathable-${base.pos.x}-${base.pos.y}`;
  const targetCacheKey = `targetPathable-${targetPosition.x}-${targetPosition.y}`;

  // Try to retrieve pathable positions from cache first
  let basePathablePositions = cacheManager.getCachedPathablePositions(baseCacheKey);
  let targetPathablePositions = cacheManager.getCachedPathablePositions(targetCacheKey);

  if (!basePathablePositions) {
    basePathablePositions = getPathablePositionsForStructure(map, base);
    cacheManager.cachePathablePositions(baseCacheKey, basePathablePositions);
  }

  if (!targetPathablePositions) {
    targetPathablePositions = getPathablePositions(map, targetPosition);
    cacheManager.cachePathablePositions(targetCacheKey, targetPathablePositions);
  }

  const pathableBasePosition = basePathablePositions[0]; // Assuming getClosestPositionByPath is abstracted
  const pathableTargetPosition = targetPathablePositions[0]; // Similarly abstracted

  return { pathableBasePosition, pathableTargetPosition };
}

/**
 * @param {MapResource} map
 * @param {Point2D} grid 
 * @returns {Point2D[]}
 */
function getCandidateWallEnds(map, grid) {
  return gridsInCircle(grid, 8).filter(gridInCircle => {
    // conditions: exists in map, is placeable, has adjacent non placeable, is same height as grid
    return (
      existsInMap(map, gridInCircle) &&
      map.isPlaceable(gridInCircle) &&
      getNeighbors(gridInCircle, false).filter(neighbor => !map.isPlaceable(neighbor)).length > 0 &&
      map.getHeight(gridInCircle) === map.getHeight(grid)
    );
  });
}

/**
 * @param {MapResource} map
 * @param {Point2D[]} candidateWallEnds
 * @param {Point2D[]} pathToCross
 * @returns {{path: Point2D[], pathLength: number}[]}
 */
function getCandidateWalls(map, candidateWallEnds, pathToCross) {
  /** @type {{path: Point2D[], pathLength: number}[]} */
  const candidateWalls = [];

  candidateWallEnds.forEach(candidateWallEnd => {
    const candidateWallEndsThatCross = candidateWallEnds.filter(candidateWallEndTwo => {
      if (distance(candidateWallEnd, candidateWallEndTwo) < 9) return false;

      const pathCoordinates = getPathCoordinates(map.path(candidateWallEnd, candidateWallEndTwo, { diagonal: true, force: true }));

      if (pathCoordinates.some(grid => getNeighbors(grid).some(neighbor => map.isRamp(neighbor)))) return false;

      // get indices where pathCoordinates crosses pathToCross
      const pathCoordinatesCrossIndices = pathCoordinates
        .map((pathCoordinate, index) => ({ index, crosses: pathToCross.some(pathToCrossCoordinate => distance(pathCoordinate, pathToCrossCoordinate) <= 1) }))
        .filter(({ crosses }) => crosses)
        .map(({ index }) => index);

      // check if crossing indices are sequential
      const isSequential = pathCoordinatesCrossIndices.every((value, index, array) => index === 0 || value === array[index - 1] + 1);

      // only return true if pathCoordinates cross pathToCross exactly once, or crosses multiple times but sequentially
      return pathCoordinatesCrossIndices.length === 1 || isSequential;
    });

    if (candidateWallEndsThatCross.length > 0) {
      const [closestCandidateWallEndThatCross] = getClosestPosition(candidateWallEnd, candidateWallEndsThatCross);
      const pathCoordinates = getPathCoordinates(map.path(candidateWallEnd, closestCandidateWallEndThatCross, { diagonal: true, force: true }));

      if (areCandidateWallEndsUnique(candidateWalls, pathCoordinates)) {
        candidateWalls.push({ path: pathCoordinates, pathLength: pathCoordinates.length });
      }
    }
  });

  candidateWalls.sort((a, b) => a.pathLength - b.pathLength);
  return candidateWalls;
}
/**
 * Finds the closest base by path to a given position from a list of bases.
 * @param {ResourceManager} resources 
 * @param {Point2D} targetPos 
 * @param {Unit[]} bases 
 * @returns {Unit}
 */
function getClosestBaseByPath(resources, targetPos, bases) {
  return getClosestUnitByPath(resources, targetPos, bases)[0];
}

/**
 * @param {MapResource} map
 * @param {Point2D[]} wallOffGrids
 * @param {Debugger | undefined} debug
 * @returns {boolean}
 */
function isPathBlocked(map, wallOffGrids, debug = undefined) {
  const { townhallPosition } = map.getNatural();
  const { townhallPosition: enemyTownhallPosition } = map.getEnemyNatural();

  // Filter out those grids that were originally pathable
  const originallyPathable = wallOffGrids.filter(grid => map.isPathable(grid));

  // Set originally pathable grids in the wall to not pathable
  originallyPathable.forEach(grid => map.setPathable(grid, false));

  // Get a path from the townhall to the outside point
  const path = getMapPath(map, townhallPosition, enemyTownhallPosition, { force: true, diagonal: false });
  debug && debug.setDrawCells('pth', getPathCoordinates(path).map(r => ({ pos: r })), { size: 1, cube: false });
  // Set those grids back to pathable which were originally pathable
  originallyPathable.forEach(grid => map.setPathable(grid, true));
  getMapPath(map, townhallPosition, enemyTownhallPosition, { force: true, diagonal: false });
  // If the path exists and does not intersect the wall, then the path is not blocked
  return path.length === 0;
}

module.exports = {
  areCandidateWallEndsUnique,
  calculatePathablePositions,
  findPathablePositions,
  getCandidateWallEnds,
  getCandidateWalls,
  getClosestBaseByPath,
  isPathBlocked
};