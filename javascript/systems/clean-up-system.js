// @ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const dataService = require("../services/data-service");
const sharedService = require("../services/shared-service");
const unitService = require("../services/unit-service");


module.exports = createSystem({
  name: 'CleanUpSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { units } = resources.get();
    dataService.earmarks = [];
    sharedService.removePendingOrders(units);
    unitService.selfUnits = new Map();
  }
});