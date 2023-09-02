// @ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const dataService = require("../services/data-service");
const sharedService = require("../services/shared-service");
const unitService = require("../services/unit-service");
const agentService = require("../services/agent-service");
const worldService = require("../src/world-service");
const MapResourceService = require("./map-resource-system/map-resource-service");


module.exports = createSystem({
  name: 'CleanUpSystem',
  type: 'agent',
  async onStep(world) {
    const { resources } = world;
    const { units } = resources.get();
    dataService.earmarks = [];
    MapResourceService.freeGasGeysersCache = new Map();
    sharedService.removePendingOrders(units);
    unitService.selfDPSHealth = new Map();
    unitService.selfUnits = new Map();
    agentService.hasTechFor = new Map();
    worldService.availableProductionUnits = new Map();
    worldService.productionUnitsCache = new Map();
  },
  async onUnitIdle(world) {
    const { resources } = world;
    const { units } = resources.get();
    sharedService.removePendingOrders(units);
    unitService.selfDPSHealth = new Map();
    unitService.selfUnits = new Map();
  }
});