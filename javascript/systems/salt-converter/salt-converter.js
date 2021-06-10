//@ts-check
"use strict"

const { UnitType, Upgrade } = require("@node-sc2/core/constants");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");
const planService = require("../../services/plan-service");
const mismatchMappings = require("./mismatch-mapping");

module.exports = {
  convertPlan: (build, race) => {
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
          const unitType = UnitType[unitTypeAction];
          unitCount.set(unitType, unitCount.has(unitType) ? unitCount.get(unitType) + 1 : TownhallRace[race].indexOf(unitType) === 0 ? 1 : 0);
          planStep.unitType = unitType;
          planStep.targetCount = unitCount.get(unitType);
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
    planService.setPlan(convertedPlan);
  },
}