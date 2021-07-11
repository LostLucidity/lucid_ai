//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");

const sharedService = {
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
  }
}

module.exports = sharedService;