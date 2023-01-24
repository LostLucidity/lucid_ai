//@ts-check
"use strict"

const { Race } = require("@node-sc2/core/constants/enums");
const { gasMineTypes } = require("@node-sc2/core/constants/groups");
const { TECHLAB, REACTOR, PYLON } = require("@node-sc2/core/constants/unit-type");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { createPoint2D } = require("@node-sc2/core/utils/geometry/point");
const { getAddOnBuildingPlacement } = require("../helper/placement/placement-utilities");
const { getDistance } = require("./position-service");

const placementService = {
  /**
   * 
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @param {Point2D} position 
   * @returns {boolean}
   */
  keepPosition: (world, unitType, position) => {
    const { agent, resources } = world;
    const { race } = agent; if (race === undefined) { return false; }
    const { map, units } = resources.get();
    const inRangeOfFreeGasGeyser = gasMineTypes.includes(unitType) && map.freeGasGeysers().some(gasGeyser => gasGeyser.pos && getDistance(gasGeyser.pos, position) <= 1);
    const conditions = [map.isPlaceableAt(unitType, position) || inRangeOfFreeGasGeyser];
    if (race === Race.PROTOSS) {
      const pylonExists = units.getById(PYLON).length > 0;
      conditions.push(pylonExists);
    }
    return conditions.every(condition => condition)
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