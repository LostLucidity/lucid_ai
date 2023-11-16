//@ts-check
"use strict"

const { UnitType } = require("@node-sc2/core/constants");
const planService = require("../../services/plan-service");
const { Race } = require("@node-sc2/core/constants/enums");
const { SupplyUnitRace } = require("@node-sc2/core/constants/race-map");
const { build } = require("../services/building-management");
const { PlacementService } = require("../services/placement");

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

/**
 * @param {World} world
 * @param {Function} trainFunc
 * @returns {Promise<void>} 
 */
async function buildSupply(world, trainFunc) {
  const { OVERLORD, PYLON, SUPPLYDEPOT } = UnitType;
  const { agent } = world;
  const { foodUsed, minerals } = agent; if (foodUsed === undefined || minerals === undefined) return;
  const greaterThanPlanSupply = foodUsed > planService.planMax.supply;
  const conditions = [
    isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512) &&
    planService.automateSupply,
  ];
  if (conditions.some(condition => condition)) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositions = PlacementService.findPlacements(world, SUPPLYDEPOT);
        await build(world, SUPPLYDEPOT, null, candidatePositions);
        break;
      }
      case Race.PROTOSS: {
        const candidatePositions = PlacementService.findPlacements(world, PYLON);
        await build(world, PYLON, null, candidatePositions);
        break;
      }
      case Race.ZERG: await trainFunc(world, OVERLORD); break;
    }
  }
}

// Add other shared functions here as needed

// Export the functions so they can be imported and used by other modules
module.exports = {
  isSupplyNeeded,
  buildSupply
};