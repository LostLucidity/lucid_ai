//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { calculateNearSupply } = require("../helper/battle-analysis");

const sharedService = {
  isPendingContructing: (unit) => {
    return unit.pendingOrders && unit.pendingOrders.some(o => constructionAbilities.includes(o.abilityId));
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
}

module.exports = sharedService;