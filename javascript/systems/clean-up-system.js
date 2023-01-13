// @ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const dataService = require("../services/data-service");
const sharedService = require("../services/shared-service");


module.exports = createSystem({
  name: 'CleanUpSystem',
  type: 'agent',
  async onStep(world) {
    const { data, resources } = world;
    const { units } = resources.get();
    dataService.earmarks = [];
    sharedService.removePendingOrders(units);
  }
});