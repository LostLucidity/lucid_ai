//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../helper/get-closest");
const wallOffRampService = require("./wall-off-ramp-service");
const { distanceByPath } = require("../../helper/get-closest-by-path");
const { intersectionOfPoints } = require("../../helper/utilities");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { BARRACKS, SUPPLYDEPOT } = require("@node-sc2/core/constants/unit-type");
const { getAddOnPlacement, isBuildingAndAddonPlaceable, getAddOnBuildingPlacement } = require("../../helper/placement/placement-utilities");

module.exports = createSystem({
  name: 'WallOffRamp',
  type: 'agent',
  async onGameStart({ resources }) {
    const { debug, map } = resources.get();
    debug.setDrawCells('ramps', map._ramps.map(r => ({ pos: r })), { size: 1, cube: true });
    const naturalTownhallPosition = map.getNatural().townhallPosition;
    wallOffRampService.adjacentToRampGrids = map.getMain().areas.placementGrid.filter(grid => {
      return (
        distance(grid, getClosestPosition(grid, map._ramps)[0]) < 2 &&
        distanceByPath(resources, naturalTownhallPosition, grid) < distanceByPath(resources, naturalTownhallPosition, map.getMain().townhallPosition)
      );
    });
    debug.setDrawCells('adToRamp', wallOffRampService.adjacentToRampGrids.map(r => ({ pos: r })), { size: 1, cube: true });
    // const supplyDepotPlacements = getSupplyDepotPlacements(map);
    // const barracksPlacement = getBarracksPlacement(supplyDepotPlacements);
  },
});

function getSupplyDepotPlacements(map) {
  const cornerGrids = wallOffRampService.placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 1), wallOffRampService.placeableGrids).length === 2);
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
        let position = null;
        wallOffPositions.push(position);
      }
    }
  });
  return wallOffPositions;
}

function getBarracksPlacement(map, supplyDepotPlacements) {
  const placeableGrids = wallOffRampService.placeableGrids.filter(grid => ![...supplyDepotPlacements].includes(grid));
  const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 1), placeableGrids).length === 2);
  const [closestCornerGrid] = getClosestPosition(map.getMain().townhallPosition, cornerGrids);
  let wallOffPosition;
  if (closestCornerGrid) {
    const cornerGridCircle = gridsInCircle(closestCornerGrid, 3);
    let closestPlaceableGrids = getClosestPosition(closestCornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
      return isBuildingAndAddonPlaceable(map, BARRACKS, grid);
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
        if (isBuildingAndAddonPlaceable(map, BARRACKS, closestPlaceableToRamp)) {
          position = closestPlaceableToRamp;
        } else {
          position = getAddOnBuildingPlacement(closestPlaceableToRamp);
        }
        wallOffPosition = position;
      }
    }
  }
  return wallOffPosition;
}

