//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { ZERGLING } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { calculateNearDPSHealth } = require("./data-service");

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
}

module.exports = sharedService;