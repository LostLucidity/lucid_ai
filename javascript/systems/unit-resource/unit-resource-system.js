//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { SIEGETANKSIEGED } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const unitResourceService = require("./unit-resource-service");

module.exports = createSystem({
  name: 'UnitResourceSystem',
  type: 'agent',
  async onStep(world) {
    unitResourceService.seigeTanksSiegedGrids = []
    world.resources.get().units.getById(SIEGETANKSIEGED).forEach(unit => {
      unitResourceService.seigeTanksSiegedGrids.push(...gridsInCircle(unit.pos, unit.radius, { normalize: true }))
    });
  }
});