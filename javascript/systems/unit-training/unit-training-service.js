//@ts-check
"use strict"

const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");
const { WARPGATE } = require("@node-sc2/core/constants/unit-type");
const shortOnWorkers = require("../../helper/short-on-workers");

const unitTrainingService = {
  selectedTypeToBuild: null,
  haveAvailableProductionUnitsFor: (world, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const warpInAbilityId = WarpUnitAbility[unitType];
    const { abilityId } = data.getUnitTypeData(unitType);
    return (
      units.getById(WARPGATE).some(warpgate => warpgate.abilityAvailable(warpInAbilityId)) ||
      units.getProductionUnits(unitType).some(unit => (unit.noQueue || (unit.hasReactor() && unit.orders.length < 2)) && unit.abilityAvailable(abilityId))
    );
  },
  workersTrainingTendedTo: (world) => {
    if (world.agent.race !== Race.ZERG) {
      const { resources } = world;
      return resources.get().units.getBases(Alliance.SELF).filter(base => base.buildProgress >= 1 && base.isIdle()).length === 0 && shortOnWorkers(resources);
    }
  },
}

module.exports = unitTrainingService;