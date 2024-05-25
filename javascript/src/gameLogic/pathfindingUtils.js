// src/core/utils/pathfindingUtils.js
"use strict";

const { getClosestPathWithGasGeysers } = require("./economy/workerService");
const { getClosestUnitByPath } = require("./pathfinding");
const { getPathablePositions } = require("./pathfindingCommon");
const cacheManager = require("../core/utils/cache");
const { getPathablePositionsForStructure } = require("../core/utils/common");


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
 * Finds the closest base by path to a given position from a list of bases.
 * @param {ResourceManager} resources 
 * @param {Point2D} targetPos 
 * @param {Unit[]} bases 
 * @returns {Unit}
 */
function getClosestBaseByPath(resources, targetPos, bases) {
  return getClosestUnitByPath(resources, targetPos, bases)[0];
}

module.exports = {
  calculatePathablePositions,
  findPathablePositions,
  getClosestBaseByPath,
};