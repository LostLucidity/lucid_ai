//@ts-check
"use strict"

const { TECHLAB, REACTOR, PYLON } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D, distance } = require("@node-sc2/core/utils/geometry/point");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { getAddOnBuildingPlacement } = require("../helper/placement/placement-utilities");

const placementService = {
  keepPosition: (resources, unitType, position) => {
    const { map, units } = resources.get()
    const [pylon] = units.getById(PYLON);
    return [
      pylon,
      pylon.buildProgress < 1,
      map.isPlaceableAt(unitType, position),
    ].every(condition => condition)
  },
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