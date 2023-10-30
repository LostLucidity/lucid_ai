//@ts-check
"use strict"

// === IMPORTS & CONSTANTS ===
const MapResourceService = require("../../../systems/map-resource-system/map-resource-service");
const dataService = require("../../../services/data-service");
const planService = require("../../../services/plan-service");
const { UnitType } = require("@node-sc2/core/constants");
const { upgradeTypes, countTypes } = require("../../../helper/groups");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { getFoodUsed } = require("./info-utils");
const { getTimeInSeconds } = require("../../../services/frames-service");

// === FUNCTION DEFINITIONS ===

/**
 * @param {DataStorage} data 
 * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
 */
function addEarmark(data, orderData) {
  const { ZERGLING } = UnitType;

  const { name, mineralCost, vespeneCost } = orderData;

  if (dataService.earmarkThresholdReached(data) || name === undefined || mineralCost === undefined || vespeneCost === undefined) return;

  const foodKey = `${getFoodUsed() + dataService.getEarmarkedFood()}`;
  const stepKey = `${planService.currentStep}`;
  const fullKey = `${stepKey}_${foodKey}`;

  let minerals = 0;
  let foodEarmark = dataService.foodEarmarks.get(fullKey) || 0;

  if ('unitId' in orderData) {
    const isZergling = orderData.unitId === ZERGLING;
    const { attributes, foodRequired, race, unitId } = orderData;

    if (attributes !== undefined && foodRequired !== undefined && race !== undefined && unitId !== undefined) {
      const adjustedFoodRequired = isZergling ? foodRequired * 2 : foodRequired;
      dataService.foodEarmarks.set(fullKey, foodEarmark + adjustedFoodRequired);

      // Check for town hall upgrades
      for (let [base, upgrades] of upgradeTypes.entries()) {
        if (upgrades.includes(unitId)) {
          const baseTownHallData = data.getUnitTypeData(base);
          minerals = -(baseTownHallData?.mineralCost ?? 400); // defaulting to 400 if not found
          break;
        }
      }

      if (race === Race.ZERG && attributes.includes(Attribute.STRUCTURE)) {
        dataService.foodEarmarks.set(fullKey, foodEarmark - 1);
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
  dataService.earmarks.push(earmark);
}

/**
 * Checks if a given position is on the creep.
 * @param {Point2D} position - The position to check.
 * @returns {Boolean} - True if the position is on the creep, false otherwise.
 */
function isOnCreep(position) {
  const { x, y } = position;
  if (x === undefined || y === undefined) return false;
  const grid = `${Math.floor(x)}:${Math.floor(y)}`;
  return MapResourceService.creepPositionsSet.has(grid);
}


/**
 * @param {{ [x: string]: any; }} constants
 * @param {any} value
 */
function getStringNameOfConstant(constants, value) {
  return `${Object.keys(constants).find(constant => constants[constant] === value)}`;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 **/
function getTimeToTargetCost(world, unitType) {
  const { agent, data, resources } = world;
  const { minerals } = agent; if (minerals === undefined) return Infinity;
  const { frame } = resources.get();
  const { score } = frame.getObservation(); if (score === undefined) return Infinity;
  const { scoreDetails } = score; if (scoreDetails === undefined) return Infinity;
  const collectionRunup = frame.getGameLoop() < 292;
  let { collectionRateMinerals, collectionRateVespene } = scoreDetails; if (collectionRateMinerals === undefined || collectionRateVespene === undefined) return Infinity;
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
  const { vespeneCost } = data.getUnitTypeData(unitType); if (vespeneCost === undefined) return Infinity;
  const vespeneCollectionRate = collectionRateVespene / 60;
  let timeToTargetVespene = 0;
  if (vespeneCost > 0) {
    if (vespeneCollectionRate === 0) {
      return Infinity;
    } else {
      timeToTargetVespene = vespeneLeft / vespeneCollectionRate;
    }
  }
  return Math.max(timeToTargetMinerals, timeToTargetVespene);
}


/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
function getTimeToTargetTech(world, unitType) {
  const { data, resources } = world;
  const { units } = resources.get();
  const unitTypeData = data.getUnitTypeData(unitType);
  const { techRequirement } = unitTypeData;
  if (techRequirement === undefined || techRequirement === 0) return 0;
  const { buildTime } = data.getUnitTypeData(techRequirement);
  if (buildTime === undefined) return 0;

  // Check for morphed units which still meet tech requirement
  const possibleTechUnits = countTypes.has(techRequirement) ? countTypes.get(techRequirement) : [techRequirement];
  if (possibleTechUnits !== undefined) {
    const [techUnit] = units.getById(possibleTechUnits).sort((a, b) => {
      const { buildProgress: buildProgressA } = a;
      const { buildProgress: buildProgressB } = b;
      if (buildProgressA === undefined || buildProgressB === undefined) return 0;
      return buildProgressB - buildProgressA;
    });
    if (techUnit !== undefined) {
      const { buildProgress } = techUnit;
      if (buildProgress !== undefined) {
        return getTimeInSeconds((1 - buildProgress) * buildTime);
      }
    }
  }

  return 0;
}

// Export the functions
module.exports = {
  addEarmark,
  isOnCreep,
  getStringNameOfConstant,
  getTimeToTargetCost,
  getTimeToTargetTech,
};