//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { Attribute } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const UnitAbilityMap = require("@node-sc2/core/constants/unit-ability-map");
const unitType = require("@node-sc2/core/constants/unit-type");
const { haveAvailableProductionUnitsFor } = require("./unit-training/unit-training-service");

module.exports = createSystem({
  async onStep(world) {
    const { agent, data } = world;
    const workerType = WorkerRace[agent.race];
    const canOrder = Object.values(unitType).filter(type => {
      if (data.getUnitTypeData(type).attributes.includes(Attribute.STRUCTURE)) {
        return UnitAbilityMap[workerType].includes(data.getUnitTypeData(type).abilityId) && world.resources.get().units.getById(data.getUnitTypeData(type).techRequirement, { buildProgress: 1 }).length > 0;
      } else {
        return haveAvailableProductionUnitsFor(world, type) && agent.hasTechFor(type)
      }
    });
  }
});