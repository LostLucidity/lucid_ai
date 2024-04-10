//@ts-check
"use strict";

// src/resourceManagement.js
const { UnitType } = require('@node-sc2/core/constants');
const { Race, Attribute } = require('@node-sc2/core/constants/enums');
const { GasMineRace } = require('@node-sc2/core/constants/race-map');

// Import necessary constants and modules
const { planMax } = require('../../../config/config');
const GameState = require('../../core/gameState');
const { calculateDistance } = require('../../gameLogic/coreUtils');
const { getTimeToTargetTech, upgradeTypes } = require('../../utils/misc/gameData');
const StrategyManager = require('../strategy/strategyManager');

const earmarks = [];

const foodEarmarks = new Map();

/**
 * @param {DataStorage} data 
 * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
 */
function addEarmark(data, orderData) {
  const gameState = GameState.getInstance();
  const race = gameState.getRace();

  // If race information is not available, exit the function
  if (race === null) {
    console.warn("Race information not available in addEarmark.");
    return;
  }

  const strategyManager = StrategyManager.getInstance(race);
  const foodUsed = gameState.getFoodUsed(); // Use the getFoodUsed method

  const { ZERGLING } = UnitType;

  const { name, mineralCost, vespeneCost } = orderData;

  if (earmarkThresholdReached(data) || name === undefined || mineralCost === undefined || vespeneCost === undefined) return;

  const foodKey = `${foodUsed + getEarmarkedFood()}`;
  const stepKey = `${strategyManager.getCurrentStep()}`;
  const fullKey = `${stepKey}_${foodKey}`;

  let minerals = 0;
  let foodEarmark = foodEarmarks.get(fullKey) || 0;

  if ('unitId' in orderData) {
    const isZergling = orderData.unitId === ZERGLING;
    const { attributes, foodRequired, race, unitId } = orderData;

    if (attributes !== undefined && foodRequired !== undefined && race !== undefined && unitId !== undefined) {
      const adjustedFoodRequired = isZergling ? foodRequired * 2 : foodRequired;
      foodEarmarks.set(fullKey, foodEarmark + adjustedFoodRequired);

      // Check for town hall upgrades
      for (let [base, upgrades] of upgradeTypes.entries()) {
        if (upgrades.includes(unitId)) {
          const baseTownHallData = data.getUnitTypeData(base);
          minerals = -(baseTownHallData?.mineralCost ?? 400); // defaulting to 400 if not found
          break;
        }
      }

      if (race === Race.ZERG && attributes.includes(Attribute.STRUCTURE)) {
        foodEarmarks.set(fullKey, foodEarmark - 1);
      }
    }

    minerals += isZergling ? mineralCost * 2 : mineralCost;
  } else if ('upgradeId' in orderData) {
    // This is an upgrade
    minerals += mineralCost;
  }

  // set earmark name to include step number and food used plus food earmarked
  const earmarkName = `${name}_${fullKey}`;
  const earmark = {
    name: earmarkName,
    minerals,
    vespene: vespeneCost,
  }
  data.addEarmark(earmark);
  earmarks.push(earmark);
}

/**
 * @param {DataStorage} data 
 * @returns {boolean}
 */
function earmarkThresholdReached(data) {
  const { minerals: earmarkedTotalMinerals, vespene: earmarkedTotalVespene } = data.getEarmarkTotals('');
  return earmarkedTotalMinerals > 512 && earmarkedTotalVespene > 512 || earmarkedTotalMinerals > 1024;
}

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
   * @description Get total food earmarked for all steps
   * @returns {number}
   */
function getEarmarkedFood() {
  return Array.from(foodEarmarks.values()).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
}

/**
 * Retrieves gas geysers near a given position.
 * @param {UnitResource} units - The units resource object.
 * @param {Point2D} pos - The position to check near.
 * @param {number} [radius=8] - The radius within which to search for gas geysers.
 * @returns {Unit[]} - Array of gas geyser units near the given position.
 */
function getGasGeysersNearby(units, pos, radius = 8) {
  const gasGeysers = units.getGasGeysers();
  return gasGeysers.filter(geyser => {
    if (!geyser.pos) return false;
    return calculateDistance(pos, geyser.pos) <= radius;
  });
}

/**
 * Retrieves mineral fields near a given position.
 * @param {UnitResource} units - The units resource object.
 * @param {Point2D} pos - The position to check near.
 * @param {number} [radius=8] - The radius within which to search for mineral fields.
 * @returns {Unit[]} - Array of mineral field units near the given position.
 */
function getMineralFieldsNearby(units, pos, radius = 8) {
  const mineralFields = units.getMineralFields();
  return mineralFields.filter(field => {
    if (!field.pos) return false;
    return calculateDistance(pos, field.pos) <= radius;
  });
}

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

/**
 * Check if the frame stored in the map matches the current frame
 * @param {number} unitType 
 * @param {number} currentFrame 
 * @returns {boolean}
 */
function isCurrent(unitType, currentFrame) {
  const gameState = GameState.getInstance();
  const entry = gameState.unitsById.get(unitType);
  return entry ? entry.frame === currentFrame : false;
}

/**
 * Resets all earmarks.
 * 
 * Assuming `data` is an object that has a method `get` which returns an array,
 * and a method `settleEarmark` which takes a string.
 * This function clears both general and food earmarks.
 * 
 * @param {{ get: (key: string) => Earmark[], settleEarmark: (name: string) => void }} data The data object
 */
function resetEarmarks(data) {
  // Clear general earmarks
  earmarks.length = 0;
  data.get('earmarks').forEach((earmark) => data.settleEarmark(earmark.name));

  // Clear food earmarks
  foodEarmarks.clear();
}

module.exports = {
  addEarmark,
  earmarkThresholdReached,
  gasMineCheckAndBuild,
  getEarmarkedFood,
  getGasGeysersNearby,
  getMineralFieldsNearby,
  getTimeToTargetCost,
  getTimeUntilCanBeAfforded,
  hasEarmarks,
  haveSupplyForUnit,
  isCurrent,
  resetEarmarks,
};
