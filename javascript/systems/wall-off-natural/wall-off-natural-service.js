//@ts-check
"use strict"

const { GATEWAY } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getNeighbors, distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");
const getClosest = require("../../helper/get-closest");
const { getClosestPosition } = require("../../helper/get-closest");
const { pointsOverlap, intersectionOfPoints } = require("../../helper/utilities");

const wallOffNaturalService = {
  /**
   * @type {Point2D[]}
   */
  adjacentToRampGrids: [],
  /**
   * @type {Point2D[]}
   */
  threeByThreePositions: [],
  /**
   * @type {Point2D[]}
   */
  wall: [],
  /**
   * @param {ResourceManager} resources
   * @param {Point2D[]} wall
   */
  setStructurePlacements: (resources, wall) => {
    const { debug, map } = resources.get();
    /**
     * @type {Point2D[]}
     */
    let wallOffGrids = [];
    let workingWall = [...wall];
    wallOffNaturalService.threeByThreePositions = [];
    // set first building
    const threeByThreeGrid = getFootprint(GATEWAY);
    if (wallOffNaturalService.threeByThreePositions.length === 0) {
      const cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
      const cornerGrid = getRandom(cornerGrids);
      if (cornerGrid) {
        // getFootprintCandidates
        const cornerNeighbors = getNeighbors(cornerGrid, true);
        const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
          const threeByThreePlacement = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
          const temporaryWall = workingWall.filter(grid => !pointsOverlap([grid], threeByThreePlacement));
          // see if adjacent to temporary wall.
          const [closestWallGrid] = getClosestPosition(cornerNeighbor, temporaryWall);
          const wallGridNeighbors = getNeighbors(closestWallGrid, false);
          return map.isPlaceableAt(GATEWAY, cornerNeighbor) && pointsOverlap(threeByThreePlacement, wallGridNeighbors) && intersectionOfPoints(threeByThreePlacement, workingWall).length > 1;
        });
        const selectedCandidate = getRandom(placementCandidates);
        wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
        wallOffNaturalService.threeByThreePositions.push(selectedCandidate);
        workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
      }
    }
    // set gap
    if (wallOffNaturalService.threeByThreePositions.length === 1) {
      let cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
      const [doorGrid] = getClosestPosition(wallOffNaturalService.threeByThreePositions[0], cornerGrids);
      wallOffGrids.push(doorGrid);
      workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
      debug.setDrawCells('drGrd', [doorGrid].map(r => ({ pos: r })), { size: 1, cube: false });
      // set second building
      cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
      const [cornerGrid] = getClosestPosition(wallOffNaturalService.threeByThreePositions[0], cornerGrids);
      if (cornerGrid) {
        // getFootprintCandidates
        const cornerNeighbors = getNeighbors(cornerGrid, false);
        const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
          // prevent diagonal buildings.
          const placementGrids = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
          const diagonalBuilding = placementGrids.some(grid => intersectionOfPoints(getNeighbors(grid, true), wallOffGrids).length > 1);
          return map.isPlaceableAt(GATEWAY, cornerNeighbor) && !pointsOverlap(wallOffGrids, placementGrids) && !diagonalBuilding;
        });
        if (placementCandidates.length > 0) {
          const selectedCandidate = getRandom(placementCandidates);
          wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
          wallOffNaturalService.threeByThreePositions.push(selectedCandidate);
          workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
        }
      }
    }
    if (wallOffNaturalService.threeByThreePositions.length === 2) {
      const cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
      const cornerGrid = getRandom(cornerGrids);
      if (cornerGrid) {
        // getFootprintCandidates
        const cornerNeighbors = getNeighbors(cornerGrid, true);
        const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
          const threeByThreePlacement = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
          // see if adjacent to temporary wall.
          return map.isPlaceableAt(GATEWAY, cornerNeighbor) && !pointsOverlap(threeByThreePlacement, wallOffGrids) && intersectionOfPoints(threeByThreePlacement, workingWall).length > 1;
        });
        const selectedCandidate = getRandom(placementCandidates);
        if (selectedCandidate) {
          wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
          wallOffNaturalService.threeByThreePositions.push(selectedCandidate);
          workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
        }
      }
    }
    // debug.setDrawCells('wlOfPs', wallOffPositions.map(r => ({ pos: r })), { size: 1, cube: true });
    wallOffNaturalService.threeByThreePositions.forEach((position, index) => {
      debug.setDrawCells(`wlOfPs${index}`, cellsInFootprint(position, threeByThreeGrid).map(r => ({ pos: r })), { size: 1, cube: false });
    });
  }
}

module.exports = wallOffNaturalService;