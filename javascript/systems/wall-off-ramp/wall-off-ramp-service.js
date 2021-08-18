//@ts-check
"use strict"

const { SUPPLYDEPOT } = require("@node-sc2/core/constants/unit-type");

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