//@ts-check
"use strict"

const { combatTypes } = require("@node-sc2/core/constants/groups");
const { getSupply } = require("../../services/data-service");
const { getTrainingSupply } = require("../../services/shared-service");

const trackUnitsService = {
  /** @type {Unit[]} */
  previousUnits: [],
  
  inFieldSelfSupply: 0,
  /** @type {Unit[]} */
  selfUnits: [],
  selfCombatSupply: 0,
  setSelfCombatSupply: (world) => {
    const { data, resources } = world;
    trackUnitsService.inFieldSelfSupply = getSupply(data, (resources.get().units.getCombatUnits()));
    const { inFieldSelfSupply, missingUnits } = trackUnitsService;
    trackUnitsService.selfCombatSupply = inFieldSelfSupply + getTrainingSupply(world, combatTypes) + missingUnits.reduce((foodCount, missingUnit) => {
      if (missingUnit.isCombatUnit()) {
        return foodCount + data.getUnitTypeData(missingUnit.unitType).foodRequired;
      } else {
        return   foodCount  
      }       
    }, 0);
  }
}

module.exports = trackUnitsService;