//@ts-check
"use strict";

// resourceUtils.js

// Import necessary dependencies
const { UnitType } = require('@node-sc2/core/constants');
const GameState = require('./gameState');
const { foodEarmarks, earmarks } = require('./resourceData');
const { Race, Attribute } = require('@node-sc2/core/constants/enums');
const { currentStep } = require('./gameStateResources');
const { upgradeTypes } = require('./gameData');

/**
 * @param {DataStorage} data 
 * @returns {boolean}
 */
function earmarkThresholdReached(data) {
  const { minerals: earmarkedTotalMinerals, vespene: earmarkedTotalVespene } = data.getEarmarkTotals('');
  return earmarkedTotalMinerals > 512 && earmarkedTotalVespene > 512 || earmarkedTotalMinerals > 1024;
}

/**
   * @description Get total food earmarked for all steps
   * @returns {number}
   */
function getEarmarkedFood() {
  return Array.from(foodEarmarks.values()).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
}

/**
 * @param {DataStorage} data 
 * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
 */
function addEarmark(data, orderData) {
  const gameState = GameState.getInstance(); // Get the instance of GameState
  const foodUsed = gameState.getFoodUsed(); // Use the getFoodUsed method

  const { ZERGLING } = UnitType;

  const { name, mineralCost, vespeneCost } = orderData;

  if (earmarkThresholdReached(data) || name === undefined || mineralCost === undefined || vespeneCost === undefined) return;

  const foodKey = `${foodUsed + getEarmarkedFood()}`;
  const stepKey = `${currentStep}`;
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

module.exports = {
  earmarkThresholdReached,
  addEarmark,
};
