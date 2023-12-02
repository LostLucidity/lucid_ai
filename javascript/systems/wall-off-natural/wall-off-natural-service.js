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
const { getDistance, getMiddleOfStructure } = require("../../services/position-service");
const { getMapPath } = require("../map-resource-system/map-resource-service");

const wallOffNaturalService = {
  /**
   * @type {Point2D[]}
   */
  adjacentToRampGrids: [],
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
      wallOffNaturalService.wall = currentWall;
      const middleOfWall = avgPoints(currentWall);
      const wallToTownhallPoints = getPathCoordinates(map.path(middleOfWall, map.getNatural().townhallPosition))
        .filter(point => {
          const pylonFootprint = cellsInFootprint(point, getFootprint(PYLON));
          const townhallFootprint = cellsInFootprint(map.getNatural().townhallPosition, getFootprint(NEXUS));
          return map.isPlaceableAt(PYLON, point) && !pointsOverlap(pylonFootprint, townhallFootprint);
        });
      // add neighboring points to wallToTownhallPoints excluding those that already exist in wallToTownhallPoints
      // debug.setDrawCells('wl2thp', wallToTownhallPoints.map(r => ({ pos: r })), { size: 1, cube: false });
      let wallToTownhallPointsWithNeighbors = []; // In place of reduce
      for (let i = 0; i < wallToTownhallPoints.length; i++) {
        let point = wallToTownhallPoints[i];
        const neighbors = getNeighbors(point, true);
        for (let j = 0; j < neighbors.length; j++) {
          let neighbor = neighbors[j];
          if (map.isPlaceableAt(PYLON, neighbor) && !wallToTownhallPoints.some(point => point.x === neighbor.x && point.y === neighbor.y)) {
            wallToTownhallPointsWithNeighbors.push(neighbor);
          }
        }
      }
      // map for each point in wallToTownhallPointsWithNeighbors, where three by three grids can be placed with pylon power area
      const wallToTownhallPointsWithNeighborsMapped = wallToTownhallPointsWithNeighbors.map(point => {
        const pylonPowerArea = getPylonPowerArea(point);
        /** @type {Point2D[]} */
        let wallOffGrids = [];
        /** @type {Point2D | null} */
        let doorGrid = null;
        let workingWall = [...currentWall];
        const threeByThreePositions = [];
        const pylonFootprint = getFootprint(PYLON); if (pylonFootprint === undefined) return;
        const pylonCells = cellsInFootprint(point, pylonFootprint);
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

              // Add extra check here to ensure that the proposed Gateway position
              // does not conflict with any existing Pylon footprints.
              const conflictsWithPylon = pylonCells.some(pylonCell =>
                threeByThreePlacement.some(candidateCell =>
                  pylonCell.x === candidateCell.x && pylonCell.y === candidateCell.y
                )
              );

              const conditions = [
                distance(point, map.getNatural().townhallPosition) < distance(cornerNeighbor, map.getNatural().townhallPosition),
                map.isPlaceableAt(GATEWAY, cornerNeighbor),
                pointsOverlap(threeByThreePlacement, wallGridNeighbors),
                intersectionOfPoints(threeByThreePlacement, workingWall).length > 1,
                allPointsWithinGrid(threeByThreePlacement, pylonPowerArea),
                !conflictsWithPylon  // Add this line to check the new condition.
              ];
              return conditions.every(condition => condition);
            });
            const selectedCandidate = getRandom(placementCandidates);
            if (selectedCandidate) {
              wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
              if (!isPathBlocked(map, [...wallOffGrids, ...pylonCells])) {
                threeByThreePositions.push(selectedCandidate);
                workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
                break;
              }
            }
          }
        }
        // set gap
        if (threeByThreePositions.length === 1) {
          let cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const firstThreeByThreePosition = threeByThreePositions[0];
          [doorGrid] = getClosestPosition(firstThreeByThreePosition, cornerGrids.filter(grid => !getNeighbors(grid, false).some(neighbor => pointsOverlap([neighbor], pylonCells))));
          // check if doorGrid overlaps with workingWall
          workingWall = workingWall.filter(grid => doorGrid && !pointsOverlap([grid], [doorGrid]) && !pointsOverlap([grid], wallOffGrids));
          debug.setDrawCells('drGrd', [doorGrid].map(r => ({ pos: r })), { size: 1, cube: false });
          // set second building
          cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const [cornerGrid] = getClosestPosition(firstThreeByThreePosition, cornerGrids);
          if (cornerGrid) {
            // getFootprintCandidates
            const cornerNeighbors = getNeighbors(cornerGrid, false);
            const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
              // prevent diagonal buildings.
              const placementGrids = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              const diagonalBuilding = placementGrids.some(grid => intersectionOfPoints(getNeighbors(grid, true), wallOffGrids).length > 1);
              // Add extra check here to ensure that the proposed Gateway position
              // does not conflict with any existing Pylon footprints.
              const conflictsWithPylon = pylonCells.some(pylonCell =>
                wallOffGrids.some(candidateCell =>
                  pylonCell.x === candidateCell.x && pylonCell.y === candidateCell.y
                )
              );
              return (
                distance(point, map.getNatural().townhallPosition) < distance(cornerNeighbor, map.getNatural().townhallPosition) &&
                map.isPlaceableAt(GATEWAY, cornerNeighbor) &&
                !pointsOverlap(wallOffGrids, placementGrids) &&
                !diagonalBuilding &&
                allPointsWithinGrid(placementGrids, pylonPowerArea) &&
                !conflictsWithPylon
              );
            });
            if (placementCandidates.length > 0) {
              const selectedCandidate = getRandom(placementCandidates);
              wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
              if (!isPathBlocked(map, [...wallOffGrids, ...pylonCells])) {
                threeByThreePositions.push(selectedCandidate);
                workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
              }
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
              // does not conflict with any existing Pylon footprints.
              const conflictsWithPylon = pylonCells.some(pylonCell =>
                wallOffGrids.some(candidateCell =>
                  pylonCell.x === candidateCell.x && pylonCell.y === candidateCell.y
                )
              );
              return (
                distance(point, map.getNatural().townhallPosition) < distance(cornerNeighbor, map.getNatural().townhallPosition) &&
                map.isPlaceableAt(GATEWAY, cornerNeighbor) &&
                !pointsOverlap(threeByThreePlacement, wallOffGrids) &&
                intersectionOfPoints(threeByThreePlacement, workingWall).length > 1 &&
                allPointsWithinGrid(threeByThreePlacement, pylonPowerArea) &&
                !conflictsWithPylon
              );
            });
            const selectedCandidate = getRandom(placementCandidates);
            if (selectedCandidate) {
              wallOffGrids.push(...cellsInFootprint(selectedCandidate, threeByThreeGrid));
              if (!isPathBlocked(map, [...wallOffGrids, ...pylonCells])) {
                threeByThreePositions.push(selectedCandidate);
                workingWall = workingWall.filter(grid => doorGrid && !pointsOverlap([grid], [doorGrid]) && !pointsOverlap([grid], wallOffGrids));
                break;
              }
            } else {
              const placeableInPylonPowerArea = pylonPowerArea.filter(grid => {
                return getDistance(point, getMiddleOfStructure(grid, GATEWAY)) <= 6.5 && map.isPlaceableAt(GATEWAY, grid) && !pointsOverlap(cellsInFootprint(grid, threeByThreeGrid), wallOffGrids);
              });
              const [closestPlaceable] = getClosestPosition(cornerGrid, placeableInPylonPowerArea);
              if (closestPlaceable) {
                wallOffGrids.push(...cellsInFootprint(closestPlaceable, threeByThreeGrid));
                if (!isPathBlocked(map, [...wallOffGrids, ...pylonCells], debug)) {
                  threeByThreePositions.push(closestPlaceable);
                  workingWall = workingWall.filter(grid => !pointsOverlap([grid], wallOffGrids));
                  break;
                }
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

module.exports = wallOffNaturalService;