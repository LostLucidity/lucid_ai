//@ts-check
"use strict"

const { TECHLAB, REACTOR } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getAddOnBuildingPlacement } = require("../helper/placement/placement-utilities");

const placementService = {
  getBuildingFootprintOfOrphanAddons: (units) => {
    const orphanAddons = units.getById([TECHLAB, REACTOR]);
    const buildingFootprints = [];
    orphanAddons.forEach(addon => {
      buildingFootprints.push(...cellsInFootprint(createPoint2D(getAddOnBuildingPlacement(addon.pos)), { w: 3, h: 3 }));
    });
    return buildingFootprints;
  }
}

module.exports = placementService;