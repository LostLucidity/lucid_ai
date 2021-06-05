//@ts-check
"use strict"

const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { getClosestPosition } = require("../../helper/get-closest");
const { intersectionOfPoints } = require("../../helper/utilities");

const wallOffRampService = {
  adjacentToRampGrids: [],
  findWallOffPlacement: (map, unitType) => {
    const placeableGrids = module.exports.adjacentToRampGrids.filter(grid => map.isPlaceable(grid));
    const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1), placeableGrids).length === 2);
    const [ closestCornerGrid ] = getClosestPosition(map.getMain().townhallPosition, cornerGrids);
    let wallOffPosition = [];
    if (closestCornerGrid) {
      wallOffPosition.push(...getClosestPosition(closestCornerGrid, gridsInCircle(closestCornerGrid, 3).filter(grid => map.isPlaceableAt(unitType, grid))));
    }
    return wallOffPosition;
  }
}

module.exports = wallOffRampService;