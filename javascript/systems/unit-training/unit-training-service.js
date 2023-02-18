//@ts-check
"use strict"

const { WarpUnitAbility } = require("@node-sc2/core/constants");
const { WARPGATE, TECHLAB } = require("@node-sc2/core/constants/unit-type");
const dataService = require("../../services/data-service");
const { getPendingOrders, getBuildTimeLeft } = require("../../services/unit-service");

const unitTrainingService = {
  /** @type {number|null} */
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
    const { orders } = unit; if (orders === undefined) return false;
    const allOrders = orders.filter(order => {
      const { abilityId, progress } = order; if (abilityId === undefined || progress === undefined) return false;
      const unitType = dataService.unitTypeTrainingAbilities.get(abilityId); if (unitType === undefined) return false;
      const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return false;
      const buildTimeLeft = getBuildTimeLeft(unit, buildTime, progress);
      return buildTimeLeft > 8;
    });
    const currentAndPendingOrders = allOrders.concat(getPendingOrders(unit));
    const maxOrders = unit.hasReactor() ? 2 : 1;
    const conditions = [currentAndPendingOrders.length < maxOrders];
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