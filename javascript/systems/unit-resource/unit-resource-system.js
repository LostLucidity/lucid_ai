//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { SIEGETANKSIEGED, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const { readUnitTypeData } = require("../../filesystem");
const unitResourceService = require("./unit-resource-service");

module.exports = createSystem({
  name: 'UnitResourceSystem',
  type: 'agent',
  async onGameStart() {
    unitResourceService.unitTypeData = readUnitTypeData();
    console.log(unitResourceService.unitTypeData);
  },
  async onStep(world) {
    const { resources } = world;
    const { map, units } = resources.get();
    unitResourceService.seigeTanksSiegedGrids = [];
    units.getByType(SIEGETANKSIEGED).forEach(unit => {
      unitResourceService.seigeTanksSiegedGrids.push(...gridsInCircle(unit.pos, unit.radius, { normalize: true }))
    });
    const supplyDepots = units.getByType([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]);
    supplyDepots.forEach(supplyDepot => {
      const cells = cellsInFootprint(supplyDepot.pos, getFootprint(supplyDepot.unitType));
      cells.forEach(cell => {
        if (supplyDepot.unitType === SUPPLYDEPOT) {
          map.setPathable(cell, false);
        } else {
          map.setPathable(cell, true);
        }
      });
    });
  },
});