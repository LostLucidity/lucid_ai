//@ts-check
"use strict"

const { getSupply, getTrainingSupply } = require("../../helper");
const { morphMapping } = require("../../helper/groups");
const planService = require("../../services/plan-service");

const trackUnitsService = {
  previousUnits: [],
  missingUnits: [],
  checkUnitCount: ({ data, resources }, unitType, targetCount) => {
    const { units } = resources.get();
    const orders = [];
    let unitTypes = [];
    if (morphMapping.has(unitType)) {
      unitTypes = morphMapping.get(unitType);
    } else {
      unitTypes = [unitType];
    }
    let abilityId = data.getUnitTypeData(unitType).abilityId;
    units.withCurrentOrders(abilityId).forEach(unit => {
      unit.orders.forEach(order => { if (order.abilityId === abilityId) { orders.push(order); } });
    });
    const unitCount = units.getById(unitTypes).length + orders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    return unitCount === targetCount;
  },
  getSelfCombatSupply: (world) => {
    const { data, resources } = world;
    return getSupply(data, resources.get().units.getCombatUnits()) + getTrainingSupply(world, planService.trainingTypes) + trackUnitsService.missingUnits.reduce((foodCount, missingUnit) => {
      if (missingUnit.isCombatUnit()) {
        return foodCount + data.getUnitTypeData(missingUnit.unitType).foodRequired;
      } else {
        return foodCount
      }
    }, 0);
  }
}

module.exports = trackUnitsService;