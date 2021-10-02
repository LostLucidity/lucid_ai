//@ts-check
"use strict"

const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { WARPGATE } = require("@node-sc2/core/constants/unit-type");

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
  workersTrainingTendedTo: false,
}

module.exports = unitTrainingService;