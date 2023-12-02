//@ts-check
"use strict"

// Import necessary constants, enums, or other dependencies
const { UnitType } = require('@node-sc2/core/constants');
const GameState = require('./gameState');
const { earmarkThresholdReached } = require('./resourceUtils');
const { currentStep } = require('./placementUtils');
const { upgradeTypes } = require('./resourceManagement');
const { Race, Attribute } = require('@node-sc2/core/constants/enums');

// Shared data structures
let foodEarmarks = {}; // Example of a shared data structure

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

// Export the shared data and functions
module.exports = {
  addEarmark,
  foodEarmarks, // Exporting the shared data structure
};
