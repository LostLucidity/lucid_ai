//@ts-check
"use strict"

const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");
const { WARPGATE, LARVA } = require("@node-sc2/core/constants/unit-type");
const shortOnWorkers = require("../../helper/short-on-workers");

const unitTrainingService = {
  selectedTypeToBuild: null,
  haveProductionUnitsFor: (world, unitType) => {
    const { resources } = world;
    const { units } = resources.get();
    return (
      units.getById(WARPGATE).length > 0 ||
      units.getProductionUnits(unitType).length > 0
    );
  },
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
    const { agent, resources } = world;
    const { units } = resources.get();
    const idleBases = units.getBases(Alliance.SELF).filter(base => base.buildProgress >= 1 && base.isIdle()).length > 0;
    const idleLarva = units.getById(LARVA).length > 0;
    return [
      agent.minerals > 512,
      (
        (!idleBases || !idleLarva) &&
        !shortOnWorkers(resources)
      ),
    ].some(condition => condition);
  },
}

module.exports = unitTrainingService;