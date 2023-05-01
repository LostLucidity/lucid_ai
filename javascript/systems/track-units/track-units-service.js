//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { combatTypes } = require("@node-sc2/core/constants/groups");
const { morphMapping } = require("../../helper/groups");
const { getSupply } = require("../../services/data-service");
const { getTrainingSupply } = require("../../services/shared-service");
const { getById } = require("../../systems/unit-resource/unit-resource-service");

const trackUnitsService = {
  /** @type {Unit[]} */
  previousUnits: [],
  /** @type {Unit[]} */
  missingUnits: [],
  inFieldSelfSupply: 0,
  /** @type {Unit[]} */
  selfUnits: [],
  selfCombatSupply: 0,
  /**
   * @param {World} world
   * @param {UnitTypeId} unitType
   * @param {number} targetCount
   * @returns {boolean}
   */
  checkUnitCount: (world, unitType, targetCount) => {
    const { data, resources } = world;
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
    const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => u.pendingOrders && u.pendingOrders.some(o => o.abilityId === abilityId));
    const unitCount = getById(units, unitTypes).length + orders.length + unitsWithPendingOrders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;
    return unitCount === targetCount;
  },
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