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
const { distanceByPath } = require("../../services/resources-service");
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
  const natural = map.getNatural();
  const pathToEnemy = map.path(map.getNatural().townhallPosition, map.getEnemyNatural().townhallPosition);
  const coordinatesToEnemy = getPathCoordinates(pathToEnemy).filter(coordinate => {
    const baseFootprint = getFootprint(TownhallRace[agent.race][0]);
    const baseCells = cellsInFootprint(natural.townhallPosition, baseFootprint);
    return !pointsOverlap([coordinate], baseCells)
  });
  const slicedGridsToEnemy = coordinatesToEnemy.slice(4, 13);
  debug.setDrawCells('pthTEnm', slicedGridsToEnemy.map(r => ({ pos: r })), { size: 1, cube: false });
  const rampIntoNatural = slicedGridsToEnemy.some(grid => map.isRamp(grid));
  if (rampIntoNatural) {
    wallOffNaturalService.adjacentToRampGrids = natural.areas.placementGrid.filter(grid => {
      const enemyTownhallPosition = map.getEnemyNatural().townhallPosition;
      return (
        distance(grid, getClosestPosition(grid, map._ramps)[0]) < 2 &&
        distanceByPath(resources, grid, enemyTownhallPosition) < distanceByPath(resources, natural.townhallPosition, enemyTownhallPosition)
      );
    });
    const cornerGrids = wallOffNaturalService.adjacentToRampGrids.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), wallOffNaturalService.adjacentToRampGrids).length === 1);
    if (cornerGrids.length > 0) {
      wallOffNaturalService.adjacentToRampGrids = map.path(cornerGrids[0], cornerGrids[1], { diagonal: true, force: true }).map(path => ({ 'x': path[0], 'y': path[1] }));
      if (wallOffNaturalService.wall.length === 0) {
        wallOffNaturalService.wall = wallOffNaturalService.adjacentToRampGrids;
      }
      debug.setDrawCells('adTRmp', wallOffNaturalService.adjacentToRampGrids.map(r => ({ pos: r })), { size: 1, cube: false });
    }
  } else {
    /** @type {{path: Point2D[], pathLength: number}[]} */
    const wallCandidates = [];    // map wall sizes found for each sliceGridsToEnemy grid
    slicedGridsToEnemy.reverse().map(grid => {
      const candidateWallEnds = getCandidateWallEnds(map, grid);
      const candidateWalls = getCandidateWalls(map, candidateWallEnds, slicedGridsToEnemy);
      wallCandidates.push(...candidateWalls);
      // const wallEnds = [];
      // const existingGrids = gridsInCircle(grid, 8).filter(grid => existsInMap(map, grid));
      // const sortedGrids = getClosestPosition(grid, existingGrids, existingGrids.length);
      // sortedGrids.forEach(sortedGrid => {
      //   if ([
      //     !map.isPathable(sortedGrid),
      //     wallCandidates.every(candidate => distance(candidate, sortedGrid) > 1),
      //     wallEnds.every(nonPathableGrid => distance(nonPathableGrid, sortedGrid) >= 9 && distance(nonPathableGrid, sortedGrid) < 12),
      //     getNeighbors(sortedGrid, false, false).filter(neighbor => map.isPlaceable(neighbor)).length > 0,
      //   ].every(condition => condition)) {
      //     wallEnds.push(sortedGrid);
      //   }
      // });
      // if (wallEnds.length === 2) {
      //   const edgePair = [wallEnds[0], wallEnds[1]];
      //   wallCandidates.push(...wallEnds);
      //   const wallSize = distance(wallEnds[0], wallEnds[1]);
      //   const shorterWall = shortestWall > wallSize
      //   shortestWall = shorterWall ? wallSize : shortestWall;
      //   shortestEdgePair = shorterWall ? wallEnds : shortestEdgePair;
      //   return {
      //     'x': grid.x,
      //     'y': grid.y,
      //     'size': distance(wallEnds[0], wallEnds[1]),
      //     edgePair,
      //   };
      // } else {
      //   return {
      //     'x': grid.x,
      //     'y': grid.y,
      //     'size': Infinity,
      //   };
      // }
    });
    const [shortestWallCandidate, shortestWallCandidateTwo] = wallCandidates.sort((a, b) => a.pathLength - b.pathLength);
    if (shortestWallCandidate) {
      console.log('shortestWallCandidate', shortestWallCandidate);
      debug.setDrawCells('wllCnd', shortestWallCandidate.path.map(r => ({ pos: r })), { size: 1, cube: false });
      setStructurePlacements(resources, shortestWallCandidate.path, [shortestWallCandidate.path, shortestWallCandidateTwo.path]);
    }
    // get two of the shortest wall sizes in the sliceGridsToEnemyMapped array
    // const shortestWallSizes = slicedGridsToEnemyMapped.filter(grid => grid.size < Infinity).sort((a, b) => a.size - b.size).slice(0, 4);
    // // get the path length of each of the shortest wall sizes
    // const shortestWallSizesMapped = shortestWallSizes.map(grid => {
    //   const [placeablePairOne] = getClosestPosition(grid.edgePair[1], getNeighbors(grid.edgePair[0], false).filter(grid => map.isPlaceable(grid)));
    //   const [placeablePairTwo] = getClosestPosition(grid.edgePair[0], getNeighbors(grid.edgePair[1], false).filter(grid => map.isPlaceable(grid)));
    //   if (placeablePairOne && placeablePairTwo) {
    //     const pathOfShortestWall = map.path(placeablePairOne, placeablePairTwo, { diagonal: true, force: true }).map(path => ({ 'x': path[0], 'y': path[1] }));
    //     return {
    //       'x': grid.x,
    //       'y': grid.y,
    //       'size': grid.size,
    //       'path': pathOfShortestWall,
    //       'pathLength': pathOfShortestWall.length,
    //     };
    //   }
    // })
    // if (shortestEdgePair.length > 0) {
    //   const [placeablePairOne] = getClosestPosition(shortestEdgePair[1], getNeighbors(shortestEdgePair[0], false).filter(grid => map.isPlaceable(grid)));
    //   const [placeablePairTwo] = getClosestPosition(shortestEdgePair[0], getNeighbors(shortestEdgePair[1], false).filter(grid => map.isPlaceable(grid)));
    //   const pathOfShortestWall = map.path(placeablePairOne, placeablePairTwo, { diagonal: true, force: true }).map(path => ({ 'x': path[0], 'y': path[1] }));
    //   wallOffNaturalService.wall = pathOfShortestWall;
    //   debug.setDrawCells('shrwll', pathOfShortestWall.map(r => ({ pos: r })), { size: 1, cube: false });
    //   setStructurePlacements(resources, pathOfShortestWall, shortestWallSizesMapped);
    // }
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
  // For each candidateWallEnd, find other candidateWallEnds that cross the pathToCross
  const candidateWalls = [];
  candidateWallEnds.forEach(candidateWallEnd => {
    // find another candidateWallEnd that has a greater distance than 8
    const candidateWallEndsThatCross = candidateWallEnds.filter(candidateWallEndTwo => {
      if (distance(candidateWallEnd, candidateWallEndTwo) < 9) return false;
      // find path between candidateWallEnd and second candidateWallEnd
      const pathCoordinates = getPathCoordinates(map.path(candidateWallEnd, candidateWallEndTwo, { diagonal: true, force: true }));
      // find if pathCoordinates only has 1 path that is near the pathToCross
      const pathCoordinatesThatCross = pathCoordinates.filter(pathCoordinate => {
        return pathToCross.some(pathToCrossCoordinate => {
          return distance(pathCoordinate, pathToCrossCoordinate) <= 1;
        });
      }).length;
      return pathCoordinatesThatCross === 1;
    });
    if (candidateWallEndsThatCross.length > 0) {
      // get the closest candidateWallEndsThatCross to the candidateWallEnd
      const [closestCandidateWallEndThatCross] = getClosestPosition(candidateWallEnd, candidateWallEndsThatCross);
      // get the path between the candidateWallEnd and the closest candidateWallEndThatCross
      const pathCoordinates = getPathCoordinates(map.path(candidateWallEnd, closestCandidateWallEndThatCross, { diagonal: true, force: true }));
      candidateWalls.push({
        'path': pathCoordinates,
        'pathLength': pathCoordinates.length,
      });
    }
  });
  // sort candidateWalls by pathLength
  candidateWalls.sort((a, b) => a.pathLength - b.pathLength);
  return candidateWalls;
}