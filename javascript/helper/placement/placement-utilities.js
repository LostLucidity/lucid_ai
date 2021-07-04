//@ts-check
"use strict"

const { REACTOR } = require("@node-sc2/core/constants/unit-type");

const placementUtilities = {
  isBuildingAndAddonPlaceable: (map, unitType, grid) => {
    return map.isPlaceableAt(unitType, grid) && map.isPlaceableAt(REACTOR, placementUtilities.getAddOnPlacement(grid));
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
  getAddOnPlacement: (position) => {
    return { x: position.x + 3, y: position.y - 0 }
  },
}

module.exports = placementUtilities;