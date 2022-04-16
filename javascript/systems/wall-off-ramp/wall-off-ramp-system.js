//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { distance, getNeighbors } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../helper/get-closest");
const wallOffRampService = require("./wall-off-ramp-service");
const { intersectionOfPoints } = require("../../helper/utilities");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { BARRACKS, SUPPLYDEPOT } = require("@node-sc2/core/constants/unit-type");
const { getAddOnPlacement, isBuildingAndAddonPlaceable, getAddOnBuildingPlacement, getBuildingAndAddonGrids } = require("../../helper/placement/placement-utilities");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const pathService = require("../../services/path-service");

module.exports = createSystem({
  name: 'WallOffRamp',
  type: 'agent',
  async onGameStart({ resources }) {
    const { debug, map } = resources.get();
    debug.setDrawCells('ramps', map._ramps.map(r => ({ pos: r })), { size: 1, cube: true });
    const naturalTownhallPosition = map.getNatural().townhallPosition;
    wallOffRampService.adjacentToRampGrids = map.getMain().areas.placementGrid.filter(grid => {
      // check if grid is adjacent to ramp
      const adjacentGrids = getNeighbors(grid);
      const isAdjacent = adjacentGrids.some(adjacentGrid => map.isRamp(adjacentGrid));
      // check if path to grid is within natural townhall to main townhall
      const path = pathService.getPathCoordinates(map.path(naturalTownhallPosition, grid));
      const isWithinPath = path.some(point => map.isRamp(point));
      return isAdjacent && isWithinPath;
    });
    debug.setDrawCells('adToRamp', wallOffRampService.adjacentToRampGrids.map(r => ({ pos: r })), { size: 1, cube: true });
    const supplyDepotPlacements = setSupplyDepotPlacements(map);
    setBarracksPlacement(map, supplyDepotPlacements);
  },
});

function setSupplyDepotPlacements(map) {
  const placeableGrids = wallOffRampService.adjacentToRampGrids.filter(grid => map.isPlaceable(grid));
  const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 1), placeableGrids).length === 2);
  let wallOffPositions = [];
  cornerGrids.forEach(cornerGrid => {
    const cornerGridCircle = gridsInCircle(cornerGrid, 3);
    let closestPlaceableGrids = getClosestPosition(cornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
      return map.isPlaceableAt(SUPPLYDEPOT, grid);
    });
    const [closestRamp] = getClosestPosition(cornerGrid, cornerGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
      if (closestPlaceableToRamp) {
        wallOffRampService.supplyWallOffPositions.push(closestPlaceableToRamp);
        wallOffPositions.push(...cellsInFootprint(closestPlaceableToRamp, getFootprint(SUPPLYDEPOT)));
      }
    }
  });
  return wallOffPositions;
}

function setBarracksPlacement(map, supplyDepotPlacements) {
  const placeableGrids = wallOffRampService.adjacentToRampGrids.filter(grid => ![...supplyDepotPlacements].some(placement => placement.x === grid.x && placement.y === grid.y));
  const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 1), placeableGrids).length === 2);
  const [closestCornerGrid] = getClosestPosition(map.getMain().townhallPosition, cornerGrids);
  let wallOffPosition;
  if (closestCornerGrid) {
    const cornerGridCircle = gridsInCircle(closestCornerGrid, 3).filter(grid => ![...supplyDepotPlacements].some(placement => placement.x === grid.x && placement.y === grid.y));
    let closestPlaceableGrids = getClosestPosition(closestCornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
      return intersectionOfPoints(supplyDepotPlacements, getBuildingAndAddonGrids(grid, BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, BARRACKS, grid);
    });
    const [closestRamp] = getClosestPosition(closestCornerGrid, cornerGridCircle.filter(grid => map.isRamp(grid)));
    if (closestRamp) {
      closestPlaceableGrids = closestPlaceableGrids.map(grid => {
        if (distance(grid, closestRamp) < distance(getAddOnPlacement(grid), closestRamp)) {
          return grid;
        } else {
          return getAddOnPlacement(grid);
        }
      });
      const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
      if (closestPlaceableToRamp) {
        let position = null;
        if (intersectionOfPoints(supplyDepotPlacements, getBuildingAndAddonGrids(closestPlaceableToRamp, BARRACKS)).length === 0 && isBuildingAndAddonPlaceable(map, BARRACKS, closestPlaceableToRamp)) {
          position = closestPlaceableToRamp;
        } else {
          position = getAddOnBuildingPlacement(closestPlaceableToRamp);
        }
        wallOffPosition = position;
      }
    }
  }
  wallOffRampService.barracksWallOffPosition = wallOffPosition;
}

