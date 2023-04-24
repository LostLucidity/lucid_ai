// @ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const dataService = require("../services/data-service");
const sharedService = require("../services/shared-service");
const unitService = require("../services/unit-service");
const unitResourceService = require("./unit-resource/unit-resource-service");
const agentService = require("../services/agent-service");
const worldService = require("../services/world-service");


module.exports = createSystem({
  name: 'CleanUpSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { units } = resources.get();
    dataService.earmarks = [];
    sharedService.removePendingOrders(units);
    unitResourceService.workers = null;
    unitService.selfUnits = new Map();
    agentService.hasTechFor = new Map();
    worldService.availableProductionUnits = new Map();
  },
  async onUnitIdle(world) {
    const { resources } = world;
    const { units } = resources.get();
    sharedService.removePendingOrders(units);
    unitResourceService.workers = null;
    unitService.selfUnits = new Map();
  }
});