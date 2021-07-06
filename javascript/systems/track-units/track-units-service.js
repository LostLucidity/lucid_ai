//@ts-check
"use strict"

const { getSupply, getTrainingSupply } = require("../../helper");
const planService = require("../../services/plan-service");

const trackUnitsService = {
  previousUnits: [],
  missingUnits: [],
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