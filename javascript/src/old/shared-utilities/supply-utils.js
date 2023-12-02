//@ts-check
"use strict"

const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");

// common-functions-service.js

// Main Functions
/**
 * @param {World} world 
 * @param {number} buffer 
 * @returns {boolean} 
 */
function isSupplyNeeded(world, buffer = 0) {
  const { agent, data, resources } = world;
  const { foodCap, foodUsed } = agent;
  const { units } = resources.get()
  const supplyUnitId = SupplyUnitRace[agent.race];
  const buildAbilityId = data.getUnitTypeData(supplyUnitId).abilityId;
  const pendingSupply = (
    (units.inProgress(supplyUnitId).length * 8) +
    (units.withCurrentOrders(buildAbilityId).length * 8)
  );
  const pendingSupplyCap = foodCap + pendingSupply;
  const supplyLeft = foodCap - foodUsed;
  const pendingSupplyLeft = supplyLeft + pendingSupply;
  const conditions = [
    pendingSupplyLeft < pendingSupplyCap * buffer,
    !(foodCap == 200),
  ];
  return conditions.every(c => c);
}

// Add other shared functions here as needed

// Export the functions so they can be imported and used by other modules
module.exports = {
  isSupplyNeeded,
};