const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const { GATEWAY, PYLON, NEXUS } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { avgPoints, getNeighbors, distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

const BuildingPlacement = require("../features/construction/buildingPlacement");
const { pointsOverlap, intersectionOfPoints } = require("../features/shared/pathfinding/pathfinding");
const { getPathCoordinates, getClosestPosition } = require("../features/shared/pathfinding/pathfindingCommonUtils");
const { getDistanceByPath } = require("../features/shared/pathfinding/pathfindingCore");
const { shuffle } = require("../utils/commonUtils");
const { isPathBlocked, getCandidateWallEnds, getCandidateWalls, areCandidateWallEndsUnique } = require("../utils/pathfindingUtils");
const { setFoundPositions } = require("../utils/sharedUtils");
const { getDistance } = require("../utils/spatialCoreUtils");
const { getPylonPowerArea, allPointsWithinGrid } = require("../utils/spatialUtils");

class WallOffService {
  /**
   * @param {ResourceManager} resources - The resource manager to access game data.
   */
  constructor(resources) {
    this.resources = resources;
    /** @type {Point2D[]} */
    this.wall = [];
    /** @type {Point2D[]} */
    this.threeByThreePositions = [];
  }

  /**
   * Sets up the wall-off structure placements at the natural expansion.
   * @param {ResourceManager} resources - The resource manager to access game data.
   * @param {{ path: Point2D[]; pathLength: number;}[]} walls - The walls data containing paths and lengths.
   */
  // eslint-disable-next-line class-methods-use-this
  setStructurePlacements(resources, walls) {
    const { debug, map } = resources.get();
    BuildingPlacement.threeByThreePositions = [];
    let shuffledWalls = shuffle(walls);
    const threeByThreeGrid = getFootprint(GATEWAY);
    if (threeByThreeGrid === undefined) return;

    for (let i = 0; i < shuffledWalls.length; i++) {
      const currentWall = shuffledWalls[i].path;
      BuildingPlacement.wall = currentWall;
      const middleOfWall = avgPoints(currentWall);
      const wallToTownhallPoints = getPathCoordinates(map.path(middleOfWall, map.getNatural().townhallPosition))
        .filter(point => {
          const pylonFootprint = getFootprint(PYLON);
          if (!pylonFootprint) return false;
          const pylonCells = cellsInFootprint(point, pylonFootprint);
          const townhallFootprint = getFootprint(NEXUS);
          if (!townhallFootprint) return false;
          const townhallCells = cellsInFootprint(map.getNatural().townhallPosition, townhallFootprint);
          return map.isPlaceableAt(PYLON, point) && !pointsOverlap(pylonCells, townhallCells);
        });

      let wallToTownhallPointsWithNeighbors = [];
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

      const wallToTownhallPointsWithNeighborsMapped = wallToTownhallPointsWithNeighbors.map(point => {
        const pylonPowerArea = getPylonPowerArea(point);
        let wallOffGrids = [];
        /** @type {Point2D | null} */
        let doorGrid = null;
        let workingWall = [...currentWall];
        const threeByThreePositions = [];
        const pylonFootprint = getFootprint(PYLON);
        if (!pylonFootprint) return;
        const pylonCells = cellsInFootprint(point, pylonFootprint);

        if (threeByThreePositions.length === 0) {
          const cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const shuffledCornerGrids = shuffle(cornerGrids);
          for (const cornerGrid of shuffledCornerGrids) {
            const cornerNeighbors = getNeighbors(cornerGrid, true);
            const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
              const threeByThreePlacement = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              const temporaryWall = workingWall.filter(grid => !pointsOverlap([grid], threeByThreePlacement));
              const [closestWallGrid] = getClosestPosition(cornerNeighbor, temporaryWall);
              const wallGridNeighbors = getNeighbors(closestWallGrid, false);
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
                !conflictsWithPylon
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

        if (threeByThreePositions.length === 1) {
          let cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const firstThreeByThreePosition = threeByThreePositions[0];
          [doorGrid] = getClosestPosition(firstThreeByThreePosition, cornerGrids.filter(grid => !getNeighbors(grid, false).some(neighbor => pointsOverlap([neighbor], pylonCells))));
          workingWall = workingWall.filter(grid => doorGrid && !pointsOverlap([grid], [doorGrid]) && !pointsOverlap([grid], wallOffGrids));
          if (debug) {
            debug.setDrawCells('drGrd', [doorGrid].map(r => ({ pos: r })), { size: 1, cube: false });
          }

          cornerGrids = workingWall.filter(grid => intersectionOfPoints(getNeighbors(grid, true, false), workingWall).length === 1);
          const [cornerGrid] = getClosestPosition(firstThreeByThreePosition, cornerGrids);
          if (cornerGrid) {
            const cornerNeighbors = getNeighbors(cornerGrid, false);
            const placementCandidates = cornerNeighbors.filter(cornerNeighbor => {
              const placementGrids = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              const diagonalBuilding = placementGrids.some(grid => intersectionOfPoints(getNeighbors(grid, true), wallOffGrids).length > 1);
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
            const cornerNeighbors = getNeighbors(cornerGrid, true);
            const placementCandidates = /** @type {Point2D[]} */ (cornerNeighbors.filter(cornerNeighbor => {
              const threeByThreePlacement = cellsInFootprint(cornerNeighbor, threeByThreeGrid);
              const temporaryWall = workingWall.filter(grid => !pointsOverlap([grid], threeByThreePlacement));
              const [closestWallGrid] = getClosestPosition(cornerNeighbor, temporaryWall);
              const wallGridNeighbors = getNeighbors(closestWallGrid, false);
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
                !conflictsWithPylon
              ];
              return conditions.every(condition => condition);
            }))
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
                return getDistance(point, BuildingPlacement.getMiddleOfStructure(grid, GATEWAY)) <= 6.5 && map.isPlaceableAt(GATEWAY, grid) && !pointsOverlap(cellsInFootprint(grid, threeByThreeGrid), wallOffGrids);
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

      const wallToTownhallPointsWithNeighborsMappedSorted = shuffle(wallToTownhallPointsWithNeighborsMapped)
        .filter(item => item !== undefined)
        .sort((a, b) => a.workingWall.length - b.workingWall.length);

      if (wallToTownhallPointsWithNeighborsMappedSorted.length > 0) {
        const { point, threeByThreePositions } = wallToTownhallPointsWithNeighborsMappedSorted[0];
        if (threeByThreePositions.length === 3) {
          if (debug) {
            setFoundPositions(threeByThreePositions, point, debug);
          } else {
            console.warn("Debug is undefined, skipping debug drawing.");
          }
          break;
        } else {
          if (debug) {
            setFoundPositions(threeByThreePositions, point, debug);
          } else {
            console.warn("Debug is undefined, skipping debug drawing.");
          }
        }
      }
    }
  }

  /**
   * Sets up wall-off at the natural expansion.
   * @param {World} world - The game world object.
   */
  setUpWallOffNatural(world) {
    const { agent, resources } = world;
    const { debug, map } = resources.get();
    const natural = map.getNatural();
    if (!natural) return;

    const { areas, townhallPosition } = natural;
    if (!areas) return;

    const pathToEnemy = map.path(natural.townhallPosition, map.getEnemyNatural().townhallPosition);
    const coordinatesToEnemy = getPathCoordinates(pathToEnemy).filter(coordinate => {
      const race = agent.race;
      if (race) {
        const baseFootprint = getFootprint(TownhallRace[race][0]);
        if (baseFootprint) {
          const baseCells = cellsInFootprint(townhallPosition, baseFootprint);
          return !pointsOverlap([coordinate], baseCells);
        } else {
          console.error("Base footprint is undefined.");
          return false;
        }
      } else {
        console.error("Agent's race is undefined.");
        return false;
      }
    });

    const slicedGridsToEnemy = coordinatesToEnemy.slice(4, 13);
    if (debug) {
      debug.setDrawCells('pthTEnm', slicedGridsToEnemy.map(r => ({ pos: r })), { size: 1, cube: false });
    }

    const rampIntoNatural = slicedGridsToEnemy.some(grid => map.isRamp(grid));
    if (rampIntoNatural) {
      const { townhallPosition: enemyTownhallPosition } = map.getEnemyNatural();
      this.adjacentToRampGrids = areas.placementGrid.filter(grid => {
        const [closestPosition] = getClosestPosition(grid, map._ramps);
        const distanceToRamp = distance(grid, closestPosition);
        return (
          map.isPlaceable(grid) &&
          distanceToRamp < 2.5 && distanceToRamp > 1.5 &&
          getDistanceByPath(resources, grid, enemyTownhallPosition) < getDistanceByPath(resources, townhallPosition, enemyTownhallPosition)
        );
      });

      const cornerGrids = this.adjacentToRampGrids
        ? this.adjacentToRampGrids.filter(grid =>
          this.adjacentToRampGrids &&
          intersectionOfPoints(getNeighbors(grid, true, false), this.adjacentToRampGrids).length === 1
        )
        : [];

      if (cornerGrids.length > 0) {
        if (this.wall.length === 0) {
          this.wall = this.adjacentToRampGrids.slice(1, this.adjacentToRampGrids.length - 1);
        }
        if (debug) {
          debug.setDrawCells('rmpWl', this.wall.map(r => ({ pos: r })), { size: 1, cube: false });
        }
        const walls = [{ path: this.wall, pathLength: this.wall.length }];
        this.setStructurePlacements(resources, walls);
      }
    } else {
      /** @typedef {Object} WallCandidate
       * @property {Point2D[]} path - The path of the wall.
       * @property {number} pathLength - The length of the wall path.
       */

      /** @type {WallCandidate[]} */
      const wallCandidates = [];
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
        if (debug) {
          debug.setDrawCells('wllCnd', shortestWalls[0].path.map(r => ({ pos: r })), { size: 1, cube: false });
        }
        this.setStructurePlacements(resources, shortestWalls);
      }
    }
  }
}

module.exports = WallOffService;
