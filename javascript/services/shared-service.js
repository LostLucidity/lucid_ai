//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { ZERGLING } = require("@node-sc2/core/constants/unit-type");

const sharedService = {
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