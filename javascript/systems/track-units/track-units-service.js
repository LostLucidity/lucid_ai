//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { combatTypes } = require("@node-sc2/core/constants/groups");
const { morphMapping } = require("../../helper/groups");
const { getSupply } = require("../../services/data-service");
const { getTrainingSupply } = require("../../services/shared-service");
const resourceManagerService = require("../../services/resource-manager-service");

const trackUnitsService = {
  /** @type {Unit[]} */
  previousUnits: [],
  /** @type {Unit[]} */
  missingUnits: [],
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