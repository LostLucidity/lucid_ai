//@ts-check
"use strict"

const { BARRACKS } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../helper/get-closest");
const { isBuildingAndAddonPlaceable } = require("../../helper/placement/placement-utilities");
const { intersectionOfPoints } = require("../../helper/utilities");

const wallOffRampService = {
  adjacentToRampGrids: [],
  findWallOffPlacement: (map, unitType) => {
    const placeableGrids = module.exports.adjacentToRampGrids.filter(grid => map.isPlaceable(grid));
    const cornerGrids = placeableGrids.filter(grid => intersectionOfPoints(gridsInCircle(grid, 1).filter(point => distance(point, grid) <= 1), placeableGrids).length === 2);
    const [closestCornerGrid] = getClosestPosition(map.getMain().townhallPosition, cornerGrids);
    let wallOffPosition = [];
    if (closestCornerGrid) {
      const cornerGridCircle = gridsInCircle(closestCornerGrid, 3);
      let closestPlaceableGrids = getClosestPosition(closestCornerGrid, cornerGridCircle, cornerGridCircle.length).filter(grid => {
        if (unitType === BARRACKS) {
          return isBuildingAndAddonPlaceable(map, unitType, grid);
        } else {
          return map.isPlaceableAt(unitType, grid);
        }
      });
      const [closestRamp] = getClosestPosition(closestCornerGrid, cornerGridCircle.filter(grid => map.isRamp(grid)));
      if (closestRamp) {
        if (unitType === BARRACKS) {
          closestPlaceableGrids = closestPlaceableGrids.map(grid => {
            if (distance(grid, closestRamp) < distance(getAddOnPlacement(grid), closestRamp)) {
              return grid;
            } else {
              return getAddOnPlacement(grid);
            }
          });
        }
        const [closestPlaceableToRamp] = getClosestPosition(closestRamp, closestPlaceableGrids)
        if (closestPlaceableToRamp) {
          let position = null;
          if (unitType !== BARRACKS || isBuildingAndAddonPlaceable(map, unitType, closestPlaceableToRamp)) {
            position = closestPlaceableToRamp;
          } else {
            position = getAddOnBuildingPlacement(closestPlaceableToRamp);
          }
          wallOffPosition.push(position);
        }
      }
    }
    return wallOffPosition;
  }
}

function getAddOnBuildingPlacement(position) {
  return { x: position.x - 3, y: position.y }
}

function getAddOnPlacement(position) {
  return { x: position.x + 3, y: position.y - 0 }
}

module.exports = wallOffRampService;