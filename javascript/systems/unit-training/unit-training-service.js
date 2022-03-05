//@ts-check
"use strict"

const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { WARPGATE, TECHLAB } = require("@node-sc2/core/constants/unit-type");

const unitTrainingService = {
  selectedTypeToBuild: null,
  /**
   * Check unit can train now.
   * @param {World} world
   * @param {Unit} unit 
   * @param {UnitTypeId} unitType
   * @returns {boolean}
   */
  canTrainNow: (world, unit, unitType) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const conditions = [unit.noQueue || (unit.hasReactor() && unit.orders.length < 2)];
    const { techRequirement } = data.getUnitTypeData(unitType);
    if (techRequirement) {
      if (techRequirement === TECHLAB) {
        conditions.push(unit.hasTechLab());
      } else {
        conditions.push(
          units.getById(techRequirement).some(unit => {
            return unit.buildProgress >= 1;
          })
        );
      }
    }
    return conditions.every(condition => condition);
  },
  /**
   * Check if unitType has prerequisites to build when minerals are available.
   * @param {World} world 
   * @param {UnitTypeId} unitType 
   * @returns {boolean}
   */
  haveAvailableProductionUnitsFor: (world, unitType) => {
    const { resources } = world;
    const { units } = resources.get();
    const warpInAbilityId = WarpUnitAbility[unitType];
    return (
      units.getById(WARPGATE).some(warpgate => warpgate.abilityAvailable(warpInAbilityId)) ||
      units.getProductionUnits(unitType).some(unit => {
        return (
          unitTrainingService.canTrainNow(world, unit, unitType) &&
          unit.buildProgress >= 1 &&
          !unit.isEnemy()
        )
      })
    );
  },
  workersTrainingTendedTo: false,
}

module.exports = unitTrainingService;