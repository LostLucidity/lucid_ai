//@ts-check
"use strict"

const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const planService = require("../../services/plan-service");
const mismatchMappings = require("./mismatch-mapping");

module.exports = {
  convertPlan: (build) => {
    const convertedPlan = [];
    const unitCount = new Map();
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
        const planStep = {};
        let unitTypeAction = UnitType[action] ? action : mismatchMappings[action];
        let upgradeAction = Upgrade[action] ? action : mismatchMappings[action];
        if (UnitType[unitTypeAction]) {
          planStep.orderType = "UnitType";
          action = UnitType[action] ? action : mismatchMappings[action];
          unitCount.set(UnitType[unitTypeAction], unitCount.get(UnitType[unitTypeAction]) ? unitCount.get(UnitType[unitTypeAction]) + 1 : 0);
          planStep.unitType = UnitType[unitTypeAction];
          planStep.targetCount = unitCount.get(UnitType[unitTypeAction]);
        } else if (Upgrade[upgradeAction]) {
          planStep.orderType = "Upgrade";
          action = Upgrade[action] ? action : mismatchMappings[action];
          planStep.upgrade = Upgrade[upgradeAction];
        }
        planStep.food = order[0];
        convertedPlan.push(planStep);
      });
      planService.trainingTypes = Array.from(unitCount.keys());
    });
    return convertedPlan;
  },
}