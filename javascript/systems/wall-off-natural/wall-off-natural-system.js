//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { GATEWAY } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { distance, getNeighbors } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getClosestPosition } = require("../../helper/get-closest");
const { distanceByPath } = require("../../helper/get-closest-by-path");
const { existsInMap } = require("../../helper/location");
const { intersectionOfPoints } = require("../../helper/utilities");
const wallOffRampService = require("../wall-off-ramp/wall-off-ramp-service");
const { setStructurePlacements } = require("./wall-off-natural-service");
const wallOffNaturalService = require("./wall-off-natural-service");

module.exports = createSystem({
  name: 'WallOffNatural',
  type: 'agent',
  async onGameStart({ resources }) {
    const { debug, map } = resources.get();
    const natural = map.getNatural();
    const gridsToEnemy = natural.pathFromEnemy.map(path => ({ 'x': path[0], 'y': path[1] }));
    const slicedGridsToEnemy = gridsToEnemy.slice(7, 13);
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
      wallOffNaturalService.adjacentToRampGrids = map.path(cornerGrids[0], cornerGrids[1], { diagonal: true, force: true }).map(path => ({ 'x': path[0], 'y': path[1] }));
      if (wallOffNaturalService.wall.length === 0) {
        wallOffNaturalService.wall = wallOffNaturalService.adjacentToRampGrids;
      }
      debug.setDrawCells('adTRmp', wallOffNaturalService.adjacentToRampGrids.map(r => ({ pos: r })), { size: 1, cube: false });
    } else {
      const wallCandidates = [];
      let shortestWall = Infinity;
      let shortestEdgePair = []
      slicedGridsToEnemy.reverse().forEach(grid => {
        const nonPathableGrids = [];
        const existingGrids = gridsInCircle(grid, 8).filter(grid => existsInMap(map, grid));
        const sortedGrids = getClosestPosition(grid, existingGrids, existingGrids.length);
        sortedGrids.forEach(sortedGrid => {
          if ([
            wallCandidates.every(candidate => distance(candidate, sortedGrid) > 1),
            !map.isPathable(sortedGrid),
            nonPathableGrids.every(nonPathableGrid => distance(nonPathableGrid, sortedGrid) >= 9 && distance(nonPathableGrid, sortedGrid) < 12),
          ].every(condition => condition)) {
            nonPathableGrids.push(sortedGrid);
          }
        });
        if (nonPathableGrids.length === 2) {
          wallCandidates.push(...nonPathableGrids);
          const wallSize = distance(nonPathableGrids[0], nonPathableGrids[1]);
          const shorterWall = shortestWall > wallSize
          shortestWall = shorterWall ? wallSize : shortestWall;
          shortestEdgePair = shorterWall ? nonPathableGrids : shortestEdgePair;
        }
      });
      debug.setDrawCells('wllCnd', wallCandidates.map(r => ({ pos: r })), { size: 1, cube: false });
      const [placeablePairOne] = getClosestPosition(shortestEdgePair[1], getNeighbors(shortestEdgePair[0], false).filter(grid => map.isPlaceable(grid)));
      const [placeablePairTwo] = getClosestPosition(shortestEdgePair[0], getNeighbors(shortestEdgePair[1], false).filter(grid => map.isPlaceable(grid)));
      const pathOfShortestWall = map.path(placeablePairOne, placeablePairTwo, { diagonal: true, force: true }).map(path => ({ 'x': path[0], 'y': path[1] }));
      wallOffNaturalService.wall = pathOfShortestWall;
      debug.setDrawCells('shrwll', pathOfShortestWall.map(r => ({ pos: r })), { size: 1, cube: false });
      setStructurePlacements(resources, pathOfShortestWall);
    }
  }
});