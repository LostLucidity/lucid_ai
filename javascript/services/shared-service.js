//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { ZERGLING } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { calculateNearSupply, calculateNearDPSHealth } = require("../helper/battle-analysis");

const sharedService = {
  isPendingContructing: (unit) => {
    return unit.pendingOrders && unit.pendingOrders.some(o => constructionAbilities.includes(o.abilityId));
  },
  getSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  },
  getTrainingSupply: (world, unitTypes) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const trainingUnitTypes = [];
    unitTypes.forEach(type => {
      let abilityId = data.getUnitTypeData(type).abilityId;
      trainingUnitTypes.push(...units.withCurrentOrders(abilityId).map(() => type));
    });
    return trainingUnitTypes.reduce((accumulator, unitType) => accumulator + (unitType === ZERGLING ? 1 : data.getUnitTypeData(unitType).foodRequired), 0);
  },
  removePendingOrders: (units) => {
    units.getAlive(Alliance.SELF).forEach(unit => {
      if (unit['pendingOrders'] && unit['pendingOrders'].length > 0) { unit['pendingOrders'] = []; }
    });
  },
  removePendingOrderBySystemName: (units, name) => {
    units.getAlive(Alliance.SELF).forEach(unit => {
      if (unit['pendingOrders'] && unit['pendingOrders'].length > 0) {
        unit['pendingOrders'] = unit['pendingOrders'].filter(order => order.system !== name);
      }
    });
  },
  setPendingOrderBySystemName: (units, name) => {
    units.getAlive().forEach(unit => {
      if (unit['pendingOrders'] && unit['pendingOrders'].length > 0) {
        unit['pendingOrders'].forEach(order => order.system = name);
      }
    });
  },
  setSelfSupplyPowers: (data, units) => {
    units.forEach(unit => {
      unit.selfUnits = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit.selfSupply = calculateNearSupply(data, unit.selfUnits)
    });
  },
  setEnemySupplyPowers: (data, units, enemyUnits) => {
    units.forEach(unit => {
      unit.enemyUnits = enemyUnits.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16)
      unit.enemySupply = calculateNearSupply(data, unit.enemyUnits);
    });
  },
  setSelfDPSHealthPower: (data, units) => {
    units.forEach(unit => {
      unit.selfUnits = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit.selfDPSHealth = calculateNearDPSHealth(data, unit.selfUnits)
    });
  },
  setEnemyDPSHealthPower: (data, units, enemyUnits) => {
    units.forEach(unit => {
      unit.enemyUnits = enemyUnits.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16)
      unit.enemyDPSHealth = calculateNearDPSHealth(data, unit.enemyUnits);
    });
  },
}

module.exports = sharedService;