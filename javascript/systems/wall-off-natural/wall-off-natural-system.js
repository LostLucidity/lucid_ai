//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance, getNeighbors } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getClosestPosition } = require("../../helper/get-closest");
const { existsInMap } = require("../../helper/location");
const { intersectionOfPoints, pointsOverlap } = require("../../helper/utilities");
const { getPathCoordinates } = require("../../services/path-service");
const { getDistanceByPath } = require("../../services/resource-manager-service");
const { setStructurePlacements } = require("./wall-off-natural-service");
const wallOffNaturalService = require("./wall-off-natural-service");

module.exports = createSystem({
  name: 'WallOffNatural',
  type: 'agent',
  async onGameStart(world) {
  // async onStep(world) {
    setUpWallOffNatural(world);
  }
});

/**
 * @param {World} world
 */
function setUpWallOffNatural(world) {
  const { agent, resources } = world;
  const { debug, map } = resources.get();
  const natural = map.getNatural(); if (natural === undefined) return;
  const { areas, townhallPosition } = natural; if (areas === undefined) return;
  const pathToEnemy = map.path(natural.townhallPosition, map.getEnemyNatural().townhallPosition);
  const coordinatesToEnemy = getPathCoordinates(pathToEnemy).filter(coordinate => {
    const baseFootprint = getFootprint(TownhallRace[agent.race][0]);
    const baseCells = cellsInFootprint(townhallPosition, baseFootprint);
    return !pointsOverlap([coordinate], baseCells)
  });
  // debug && debug.setDrawCells('pthTEnm', coordinatesToEnemy.map(r => ({ pos: r })), { size: 1, cube: false });
  const slicedGridsToEnemy = coordinatesToEnemy.slice(4, 13);
  debug.setDrawCells('pthTEnm', slicedGridsToEnemy.map(r => ({ pos: r })), { size: 1, cube: false });
  const rampIntoNatural = slicedGridsToEnemy.some(grid => map.isRamp(grid));
  if (rampIntoNatural) {
    const { townhallPosition: enemyTownhallPosition } = map.getEnemyNatural();
    wallOffNaturalService.adjacentToRampGrids = areas.placementGrid.filter(grid => {
      const [closestPosition] = getClosestPosition(grid, map._ramps);
      const distanceToRamp = distance(grid, closestPosition);
      return (
        map.isPlaceable(grid) &&
        distanceToRamp < 2.5 && distanceToRamp > 1.5 &&
        getDistanceByPath(resources, grid, enemyTownhallPosition) < getDistanceByPath(resources, townhallPosition, enemyTownhallPosition)
      );
    });
    const cornerGrids = wallOffNaturalService.adjacentToRampGrids.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), wallOffNaturalService.adjacentToRampGrids).length === 1);
    if (cornerGrids.length > 0) {
      if (wallOffNaturalService.wall.length === 0) {
        // remove first and last element from adjacentToRampGrids
        wallOffNaturalService.wall = wallOffNaturalService.adjacentToRampGrids.slice(1, wallOffNaturalService.adjacentToRampGrids.length - 1);
      }
      debug.setDrawCells('rmpWl', wallOffNaturalService.wall.map(r => ({ pos: r })), { size: 1, cube: false });
      const walls = [{ path: wallOffNaturalService.wall, pathLength: wallOffNaturalService.wall.length }];
      setStructurePlacements(resources, walls);
    }
  } else {
    /** @type {{path: Point2D[], pathLength: number}[]} */
    const wallCandidates = [];    // map wall sizes found for each sliceGridsToEnemy grid
    slicedGridsToEnemy.reverse().map(grid => {
      const candidateWallEnds = getCandidateWallEnds(map, grid);
      const candidateWalls = getCandidateWalls(map, candidateWallEnds, slicedGridsToEnemy);
      if (areCandidateWallEndsUnique(wallCandidates, candidateWallEnds)) {
        wallCandidates.push(...candidateWalls.filter(wall => areCandidateWallEndsUnique(wallCandidates, wall.path)));
      }
    });
    const shortestWalls = wallCandidates.sort((a, b) => a.pathLength - b.pathLength).slice(0, 4);
    if (shortestWalls.length > 0) {
      console.log('shortestWallCandidate', shortestWalls[0]);
      debug.setDrawCells('wllCnd', shortestWalls[0].path.map(r => ({ pos: r })), { size: 1, cube: false });
      setStructurePlacements(resources, shortestWalls);
    }
  }
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