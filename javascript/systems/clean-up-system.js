// @ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const dataService = require("../services/data-service");
const sharedService = require("../services/shared-service");
const unitService = require("../services/unit-service");
const agentService = require("../services/agent-service");
const worldService = require("../src/world-service");
const MapResourceService = require("./map-resource-system/map-resource-service");

let knownUpgrades = new Set();

/**
 * Handles tasks when an upgrade is completed.
 * @param {World} world - The current world state.
 * @param {number} upgradeId - The ID of the completed upgrade.
 */
async function onUpgradeCompleted(world, upgradeId) {
  const { data, resources } = world;
  console.log(`Upgrade ${upgradeId} completed`);

  // Reset the movement speed cache.
  unitService.movementSpeedByType = new Map();
  const { actions: { _client } } = resources.get();
  /** @type {SC2APIProtocol.ResponseData} */
  let gameData;
  if (_client) {
    gameData = await _client.data({ unitTypeId: true });
    ['units'].forEach((dataType) => {
      if (gameData[dataType]) data.set(dataType, gameData[dataType]);
    });
  }

  knownUpgrades.add(upgradeId);  // Update the known upgrades.
}

/**
 * CleanUpSystem handles various tasks related to cleaning up data 
 * structures and caches during the game's lifecycle.
 */
module.exports = createSystem({
  name: 'CleanUpSystem',
  type: 'agent',

  /**
   * Handle tasks on each step of the game.
   */
  async onStep(world) {
    const { agent, resources } = world;
    const { units } = resources.get();

    // Reset various caches and data structures.
    dataService.earmarks = [];
    MapResourceService.freeGasGeysersCache = new Map();
    sharedService.removePendingOrders(units);
    unitService.selfDPSHealth = new Map();
    unitService.selfUnits = new Map();
    agentService.hasTechFor = new Map();
    worldService.availableProductionUnits = new Map();
    worldService.productionUnitsCache = new Map();

    const currentUpgrades = new Set(agent.upgradeIds);

    for (const upgradeId of currentUpgrades) {
      if (!knownUpgrades.has(upgradeId)) {
        await onUpgradeCompleted(world, upgradeId);  // Await the asynchronous function.
      }
    }
  },

  /**
   * Handle tasks when a unit becomes idle.
   */
  async onUnitIdle(world) {
    const { resources } = world;
    const { units } = resources.get();

    sharedService.removePendingOrders(units);
    unitService.selfDPSHealth = new Map();
    unitService.selfUnits = new Map();
  },
});