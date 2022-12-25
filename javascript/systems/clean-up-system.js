// @ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const sharedService = require("../services/shared-service");


module.exports = createSystem({
  name: 'CleanUpSystem',
  type: 'agent',
  async onStep(world) {
    const { units } = world.resources.get();
    sharedService.removePendingOrders(units);
  }
});