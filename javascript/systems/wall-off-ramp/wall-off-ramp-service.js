//@ts-check
"use strict"

const { BARRACKS, SUPPLYDEPOT } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../../helper/get-closest");
const { isBuildingAndAddonPlaceable } = require("../../helper/placement/placement-utilities");
const { intersectionOfPoints } = require("../../helper/utilities");

const wallOffRampService = {
  adjacentToRampGrids: [],
  findWallOffPlacement: (unitType) => {
    if (unitType === SUPPLYDEPOT) {
      return wallOffRampService.supplyWallOffPositions;
    } else {
      return [wallOffRampService.barracksWallOffPosition];
    }
  },
  barracksWallOffPosition: null,
  supplyWallOffPositions: [],
}

module.exports = wallOffRampService;