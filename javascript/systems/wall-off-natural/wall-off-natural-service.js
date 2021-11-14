//@ts-check
"use strict"

const { GATEWAY } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getNeighbors, distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");
const { getClosestPosition } = require("../../helper/get-closest");
const { pointsOverlap, intersectionOfPoints } = require("../../helper/utilities");

const wallOffNaturalService = {
  /**
   * @type {Point2D[]}
   */
  threeByThreePositions: [],
  /**
   * @param {ResourceManager} resources 
   */
  setStructurePlacements: (resources) => {
    const { debug, map } = resources.get();
    let naturalWall = map.getNatural().getWall();
    /**
     * @type {Point2D[]}
     */
    let wallOffGrids = [];
    let placeableLeft = true
    /**
     * @type {Point2D[]}
     */
    let placeableAdjacentToWall = []
    let doorGrid = null;
    let wallDoorGrid = null;
    do {
      if (naturalWall.length <= 3 && placeableAdjacentToWall.length === 0) {
        naturalWall.forEach(wallGrid => {
          const newAdjacentGrids = getNeighbors(wallGrid, false).filter(circleGrid => map.isPlaceable(circleGrid) && !pointsOverlap([circleGrid], [...placeableAdjacentToWall, ...naturalWall]));
          placeableAdjacentToWall.push(...newAdjacentGrids);
        });
        doorGrid = getRandom(placeableAdjacentToWall.filter(grid => !pointsOverlap([grid], wallOffGrids)));
        if (!doorGrid) {
          wallOffNaturalService.threeByThreePositions = [];
          wallOffGrids = []
          placeableAdjacentToWall = [];
          naturalWall = map.getNatural().getWall();
        } else {
          [wallDoorGrid] = getClosestPosition(doorGrid, naturalWall);
          wallOffGrids.push(doorGrid, wallDoorGrid);
          debug.setDrawCells('drGrd', [doorGrid].map(r => ({ pos: r })), { size: 1, cube: false });
        }
      }
      const cornerGrids = naturalWall.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 2), naturalWall).length === 2);
      const cornerGrid = doorGrid ? doorGrid : getRandom(cornerGrids);
      if (cornerGrid) {
        const cornerGridCircle = gridsInCircle(cornerGrid, 3);
        let closestPlaceableGrids = getClosestPosition(cornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
          return map.isPlaceableAt(GATEWAY, grid) && !pointsOverlap(cellsInFootprint(grid, getFootprint(GATEWAY)), wallOffGrids);
        });
        const [closestWallGrid] = getClosestPosition(cornerGrid, cornerGridCircle.filter(grid => pointsOverlap([grid], doorGrid ? [...naturalWall, doorGrid] : naturalWall)));
        if (closestWallGrid) {
          const [closestPlaceableOnWall] = getClosestPosition(closestWallGrid, closestPlaceableGrids)
          if (closestPlaceableOnWall && distance(closestWallGrid, closestPlaceableOnWall) <= 3) {
            const structureGrids = cellsInFootprint(closestPlaceableOnWall, getFootprint(GATEWAY))
            wallOffGrids.push(...structureGrids);
            wallOffNaturalService.threeByThreePositions.push(closestPlaceableOnWall);
            naturalWall = naturalWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
          } else {
            placeableLeft = false;
          }
        } else {
          placeableLeft = false;
        }
      } else {
        placeableLeft = false;
      }
    } while (placeableLeft);
    // debug.setDrawCells('wlOfPs', wallOffPositions.map(r => ({ pos: r })), { size: 1, cube: true });
    wallOffNaturalService.threeByThreePositions.forEach((position, index) => {
      debug.setDrawCells(`wlOfPs${index}`, cellsInFootprint(position, getFootprint(GATEWAY)).map(r => ({ pos: r })), { size: 1, cube: false });
    });
  }
}

module.exports = wallOffNaturalService;