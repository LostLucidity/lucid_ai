//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../helper/get-closest");
const wallOffRampService = require("./wall-off-ramp-service");
const { distanceByPath } = require("../../helper/get-closest-by-path");
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
  },
});