//@ts-check
"use strict"

const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const mismatchMappings = require("./mismatch-mapping");

module.exports = {
  convertPlan: (build) => {
    const convertedPlan = [];
    const unitCount = {};
    build.orders.forEach(order => {
      const actions = [];
      order[1].split(',').forEach(item => {
        const splitItem = item.split(' ');
        let itemCount = 1;
        let normalizedActionName = '';
        if (splitItem[splitItem.length - 1].charAt(0) === 'x') {
          itemCount = parseInt(splitItem[splitItem.length - 1].substring(1));
          normalizedActionName = splitItem.slice(0, splitItem.length - 1).join('').toUpperCase();
        } else {
          normalizedActionName = item.replace(/ /g, '').toUpperCase();
        }
        for (let step = 1; step <= itemCount; step++) {
          actions.push(normalizedActionName);
        }
      });
      actions.forEach(action => {
        let orderType;
        let unitType;
        let unitTypeAction = UnitType[action] ? action : mismatchMappings[action];
        let upgradeAction = Upgrade[action] ? action : mismatchMappings[action];
        if (UnitType[unitTypeAction]) {
          orderType = "UnitType";
          action = UnitType[action] ? action : mismatchMappings[action];
          unitCount[action] = unitCount.hasOwnProperty(action) ? unitCount[action] + 1 : 0;
          unitType = UnitType[unitTypeAction];
        } else if (Upgrade[upgradeAction]) {
          orderType = "Upgrade";
          action = Upgrade[action] ? action : mismatchMappings[action];
          unitType = Upgrade[upgradeAction];
        }
        let planStep = { food: order[0], orderType, unitType, targetCount: unitCount[action] };
        convertedPlan.push(planStep);
      });
    })
    return convertedPlan;
  },
}