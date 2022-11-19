//@ts-check
"use strict"

const { GATEWAY, PYLON, NEXUS } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getNeighbors, avgPoints, distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");
const { getClosestPosition } = require("../../helper/get-closest");
const { pointsOverlap, intersectionOfPoints, allPointsWithinGrid, shuffle } = require("../../helper/utilities");
const { getPathCoordinates } = require("../../services/path-service");

const wallOffNaturalService = {
  /**
   * @type {Point2D[]}
   */
  adjacentToRampGrids: [],
  /** @type {Point2D} */
  pylonPlacement: null,
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
   * @param {{ path: Point2D[]; pathLength: number;}[]} walls
   */
  setStructurePlacements: (resources, walls) => {
    const { debug, map } = resources.get();
    wallOffNaturalService.threeByThreePositions = [];
    /** @type {{ path: Point2D[]; pathLength: number;}[]} */
    let shuffledWalls = shuffle(walls);
    const threeByThreeGrid = getFootprint(GATEWAY);
    if (threeByThreeGrid === undefined) return;
    for (let i = 0; i < shuffledWalls.length; i++) {
      const currentWall = shuffledWalls[i].path;
      const middleOfWall = avgPoints(currentWall);
      const wallToTownhallPoints = getPathCoordinates(map.path(middleOfWall, map.getNatural().townhallPosition))
        .filter(point => {
          const pylonFootprint = cellsInFootprint(point, getFootprint(PYLON));
          const townhallFootprint = cellsInFootprint(map.getNatural().townhallPosition, getFootprint(NEXUS));
          return map.isPlaceableAt(PYLON, point) && !pointsOverlap(pylonFootprint, townhallFootprint);
        });
      // add neighboring points to wallToTownhallPoints excluding those that already exist in wallToTownhallPoints
      debug.setDrawCells('wl2thp', wallToTownhallPoints.map(r => ({ pos: r })), { size: 1, cube: false });
      const wallToTownhallPointsWithNeighbors = wallToTownhallPoints.reduce((acc, point) => {
        const neighbors = getNeighbors(point, true).filter(neighbor => map.isPlaceableAt(PYLON, neighbor));
        const neighborsNotInWall = neighbors.filter(neighbor => !wallToTownhallPoints.some(point => point.x === neighbor.x && point.y === neighbor.y));
        return [...acc, ...neighborsNotInWall];
      }, []);
      // map for each point in wallToTownhallPointsWithNeighbors, where three by three grids can be placed with pylon power area
      const wallToTownhallPointsWithNeighborsMapped = wallToTownhallPointsWithNeighbors.map(point => {
        const pylonPowerArea = getPylonPowerArea(point);
        let wallOffGrids = [];
        let workingWall = [...currentWall];
        const threeByThreePositions = [];
        if (threeByThreePositions.length === 0) {
          const cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const shuffledCornerGrids = shuffle(cornerGrids);
          for (const cornerGrid of shuffledCornerGrids) {
            // getFootprintCandidates
            const cornerNeighbors = getNeighbors(cornerGrid, true);
            const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
              const threeByThreePlacement = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              const temporaryWall = workingWall.filter(grid => !pointsOverlap([grid], threeByThreePlacement));
              // see if adjacent to temporary wall.
              const [closestWallGrid] = getClosestPosition(cornerNeighbor, temporaryWall);
              const wallGridNeighbors = getNeighbors(closestWallGrid, false);
              const conditions = [
                distance(point, map.getNatural().townhallPosition) < distance(cornerNeighbor, map.getNatural().townhallPosition),
                map.isPlaceableAt(GATEWAY, cornerNeighbor),
                pointsOverlap(threeByThreePlacement, wallGridNeighbors),
                intersectionOfPoints(threeByThreePlacement, workingWall).length > 1,
                allPointsWithinGrid(threeByThreePlacement, pylonPowerArea),
              ];
              return conditions.every(condition => condition);
            });
            const selectedCandidate = getRandom(placementCandidates);
            if (selectedCandidate) {
              wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
              threeByThreePositions.push(selectedCandidate);
              workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
              break;
            }
          }
        }
        // set gap
        if (threeByThreePositions.length === 1) {
          let cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const [doorGrid] = getClosestPosition(threeByThreePositions[0], cornerGrids);
          wallOffGrids.push(doorGrid);
          workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
          debug.setDrawCells('drGrd', [doorGrid].map(r => ({ pos: r })), { size: 1, cube: false });
          // set second building
          cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const [cornerGrid] = getClosestPosition(threeByThreePositions[0], cornerGrids);
          if (cornerGrid) {
            // getFootprintCandidates
            const cornerNeighbors = getNeighbors(cornerGrid, false);
            const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
              // prevent diagonal buildings.
              const placementGrids = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              const diagonalBuilding = placementGrids.some(grid => intersectionOfPoints(getNeighbors(grid, true), wallOffGrids).length > 1);
              return (
                distance(point, map.getNatural().townhallPosition) < distance(cornerNeighbor, map.getNatural().townhallPosition) &&
                map.isPlaceableAt(GATEWAY, cornerNeighbor) &&
                !pointsOverlap(wallOffGrids, placementGrids) &&
                !diagonalBuilding &&
                allPointsWithinGrid(placementGrids, pylonPowerArea)
              );
            });
            if (placementCandidates.length > 0) {
              const selectedCandidate = getRandom(placementCandidates);
              wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
              threeByThreePositions.push(selectedCandidate);
              workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
            }
          }
        }
        if (threeByThreePositions.length === 2) {
          const cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const shuffledCornerGrids = shuffle(cornerGrids);
          for (const cornerGrid of shuffledCornerGrids) {
            // getFootprintCandidates
            const cornerNeighbors = getNeighbors(cornerGrid, true);
            const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
              const threeByThreePlacement = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              // see if adjacent to temporary wall.
              return (
                distance(point, map.getNatural().townhallPosition) < distance(cornerNeighbor, map.getNatural().townhallPosition) &&
                map.isPlaceableAt(GATEWAY, cornerNeighbor) &&
                !pointsOverlap(threeByThreePlacement, wallOffGrids) &&
                intersectionOfPoints(threeByThreePlacement, workingWall).length > 1 &&
                allPointsWithinGrid(threeByThreePlacement, pylonPowerArea)
              );
            });
            const selectedCandidate = getRandom(placementCandidates);
            if (selectedCandidate) {
              wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
              threeByThreePositions.push(selectedCandidate);
              workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
              break;
            } else {
              const placeableInPylonPowerArea = pylonPowerArea.filter(grid => map.isPlaceableAt(GATEWAY, grid) && !pointsOverlap(cellsInFootprint(grid, threeByThreeGrid), wallOffGrids));
              const [closestPlaceable] = getClosestPosition(cornerGrid, placeableInPylonPowerArea);
              if (closestPlaceable) {
                wallOffGrids.push(...cellsInFootprint(closestPlaceable, threeByThreeGrid));
                threeByThreePositions.push(closestPlaceable);
                workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
                break;
              }
            }
          }
        }
        return {
          point,
          pylonPowerArea,
          threeByThreePositions,
          wallOffGrids,
          workingWall,
        };
      });

      // shuffle and sort wallToTownhallPointsWithNeighborsMapped by shortest workingWall length
      const wallToTownhallPointsWithNeighborsMappedSorted = shuffle(wallToTownhallPointsWithNeighborsMapped).sort((a, b) => a.workingWall.length - b.workingWall.length);
      // pick the first one
      if (wallToTownhallPointsWithNeighborsMappedSorted.length > 0) {
        const { point, threeByThreePositions } = wallToTownhallPointsWithNeighborsMappedSorted[0];
        if (threeByThreePositions.length === 3) {
          setFoundPositions(threeByThreePositions, point, debug);
          break;
        } else {
          setFoundPositions(threeByThreePositions, point, debug);
        }
      }
    }
  }
}

/**
 * Get pylon power area
 * @param {Point2D} position
 * @returns {Point2D[]}
 */
function getPylonPowerArea(position) {
  const pylonFootprint = cellsInFootprint(position, getFootprint(PYLON));
  const pylonPowerCircleGrids = gridsInCircle(position, 7, { normalize: true }).filter(grid => distance(grid, position) <= 6.5);
  const pylonPowerCircleGridsExcludingPylonPlacements = pylonPowerCircleGrids.filter(grid => !pointsOverlap(pylonFootprint, [grid]));
  return pylonPowerCircleGridsExcludingPylonPlacements;
}
/**
 * @param {Point2D[]} threeByThreePositions
 * @param {Point2D} point
 * @param {Debugger} debug
 */
function setFoundPositions(threeByThreePositions, point, debug) {
  const threeByThreeGrid = getFootprint(GATEWAY);
  wallOffNaturalService.threeByThreePositions = threeByThreePositions;
  wallOffNaturalService.pylonPlacement = point;
  debug.setDrawCells('pylon', cellsInFootprint(point, getFootprint(PYLON)).map(r => ({ pos: r })), { size: 1, cube: false });
  console.log('pylon placement', point);
  wallOffNaturalService.threeByThreePositions.forEach((position, index) => {
    debug.setDrawCells(`wlOfPs${index}`, cellsInFootprint(position, threeByThreeGrid).map(r => ({ pos: r })), { size: 1, cube: false });
  });
}

module.exports = wallOffNaturalService;