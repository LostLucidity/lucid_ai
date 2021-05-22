//@ts-check
"use strict"

const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const mismatchMappings = require("./mismatch-mapping");

module.exports = {
  convertPlan: (build) => {
    const convertedPlan = [];
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
        if (UnitType[action] || mismatchMappings[action]) {
          orderType = "UnitType";
          unitType = UnitType[action]
        } else if (Upgrade[action]) {
          orderType = "Upgrade";
          unitType = Upgrade[action]
        }
        let planStep = [ order[0], orderType, unitType ];
        convertedPlan.push(planStep);
      });
    })
    return convertedPlan;
  },
}