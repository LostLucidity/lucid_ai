//@ts-check
"use strict";

// src/resourceManagement.js
const { Race } = require('@node-sc2/core/constants/enums');
const { GasMineRace } = require('@node-sc2/core/constants/race-map');

// Import necessary constants and modules
const { addEarmark, getEarmarkedFood } = require('./resourceUtils');
const { planMax } = require('../../../config/config');
const GameState = require('../../core/gameState');
const { getTimeToTargetTech } = require('../misc/gameData');

/**
 * Check for gas mine construction conditions and initiate building if criteria are met.
 * @param {World} world - The game world context.
 * @param {number} targetRatio - Optional ratio of minerals to vespene gas to maintain.
 * @param {(world: World, unitType: number, targetCount?: number | undefined, candidatePositions?: Point2D[] | undefined) => SC2APIProtocol.ActionRawUnitCommand[]} buildFunction - The function to build the gas mine.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const gasMineCheckAndBuild = (world, targetRatio = 2.4, buildFunction) => {
    const { agent, data, resources } = world;
  const { map, units } = resources.get();
  const { minerals, vespene } = agent;
  const resourceRatio = (minerals ?? 0) / (vespene ?? 1);
  const gasUnitId = GasMineRace[agent.race || Race.TERRAN];
  const buildAbilityId = data.getUnitTypeData(gasUnitId).abilityId;
  if (buildAbilityId === undefined) return [];

  const [geyser] = map.freeGasGeysers();
  const conditions = [
    resourceRatio > targetRatio,
    agent.canAfford(gasUnitId),
    units.getById(gasUnitId).filter(unit => (unit.buildProgress ?? 0) < 1).length < 1,
    planMax && planMax.gasMine ? (agent.foodUsed ?? 0) > planMax.gasMine : units.getById(gasUnitId).length > 2,
    units.withCurrentOrders(buildAbilityId).length <= 0,
    geyser,
  ];

  if (conditions.every(c => c)) {
    return buildFunction(world, gasUnitId);
  }

  return [];
};

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 **/
function getTimeToTargetCost(world, unitType) {
  const { agent, data, resources } = world;
  const { minerals } = agent;
  if (minerals === undefined) return Infinity;

  const { frame } = resources.get();
  const observation = frame.getObservation();
  if (!observation) return Infinity;

  const { score } = observation;
  if (!score) return Infinity;

  const { scoreDetails } = score;
  if (!scoreDetails) return Infinity;

  const collectionRunup = frame.getGameLoop() < 292;
  let { collectionRateMinerals, collectionRateVespene } = scoreDetails;
  if (collectionRateMinerals === undefined || collectionRateVespene === undefined) return Infinity;

  if (collectionRunup) {
    collectionRateMinerals = 615;
    collectionRateVespene = 0;
  }

  addEarmark(data, data.getUnitTypeData(unitType));
  let earmarkTotals = data.getEarmarkTotals('');
  const { minerals: earmarkMinerals, vespene: earmarkVespene } = earmarkTotals;
  const mineralsLeft = earmarkMinerals - minerals;
  const vespeneLeft = earmarkVespene - (agent.vespene ?? 0);
  const mineralCollectionRate = collectionRateMinerals / 60;
  if (mineralCollectionRate === 0) return Infinity;

  const timeToTargetMinerals = mineralsLeft / mineralCollectionRate;
  const { vespeneCost } = data.getUnitTypeData(unitType);
  if (vespeneCost === undefined) return Infinity;

  const vespeneCollectionRate = collectionRateVespene / 60;
  let timeToTargetVespene = 0;
  if (vespeneCost > 0) {
    if (vespeneCollectionRate === 0) return Infinity;
    timeToTargetVespene = vespeneLeft / vespeneCollectionRate;
  }

  return Math.max(timeToTargetMinerals, timeToTargetVespene);
}

/**
 * Calculates the time in seconds until the agent can afford the specified unit type.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number} The time in seconds until the unit can be afforded.
 */
function getTimeUntilCanBeAfforded(world, unitType) {
  const timeToTargetCost = getTimeToTargetCost(world, unitType);
  const timeToTargetTech = getTimeToTargetTech(world, unitType);

  // The time until the unit can be afforded is the maximum of the two times
  return Math.max(timeToTargetCost, timeToTargetTech);
}

/**
 * Checks if there are any earmarked resources.
 * @param {DataStorage} data
 * @returns {boolean}
 */
const hasEarmarks = (data) => {
  const earmarkTotals = data.getEarmarkTotals('');
  return earmarkTotals.minerals > 0 || earmarkTotals.vespene > 0;
};

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 */
function haveSupplyForUnit(world, unitType) {
  const { agent, data } = world;
  const { foodCap } = agent; if (foodCap === undefined) return false;
  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed();
  const earmarkedFood = getEarmarkedFood();
  const { foodRequired } = data.getUnitTypeData(unitType); if (foodRequired === undefined) return false;
  const supplyLeft = foodCap - foodUsed - earmarkedFood - foodRequired;
  return supplyLeft >= 0;
}

module.exports = {
  gasMineCheckAndBuild,
  getTimeToTargetCost,
  getTimeUntilCanBeAfforded,
  hasEarmarks,
  haveSupplyForUnit,
};
