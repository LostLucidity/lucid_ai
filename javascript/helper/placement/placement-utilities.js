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
  getAddOnPosition: (position) => {
    return { x: position.x + 2.5, y: position.y - 0.5 }
  },
}

module.exports = placementUtilities;