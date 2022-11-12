//@ts-check
"use strict"

const { REACTOR } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");

const placementUtilities = {
  isBuildingAndAddonPlaceable: (map, unitType, grid) => {
    return map.isPlaceableAt(unitType, grid) && map.isPlaceableAt(REACTOR, placementUtilities.getAddOnPlacement(grid));
  },
  getBuildingAndAddonGrids: (pos, unitType) => {
    return [...cellsInFootprint(pos, getFootprint(unitType)), ...cellsInFootprint(placementUtilities.getAddOnPlacement(pos), getFootprint(REACTOR))];
  },
  getAddOnBuildingPosition: (position) => {
    return { x: position.x - 2.5, y: position.y + 0.5 }
  },
  getAddOnPosition: (position) => {
    return { x: position.x + 2.5, y: position.y - 0.5 }
  },
  getAddOnBuildingPlacement: (position) => {
    return { x: position.x - 3, y: position.y }
  },
  /**
   * @param {Point2D} position 
   * @returns {Point2D}
   */
  getAddOnPlacement: (position) => {
    const { x, y } = position; if (x === undefined) return position;
    return { x: x + 3, y: y }
  },
}

module.exports = placementUtilities;