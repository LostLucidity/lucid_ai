//@ts-check
"use strict";

// src/gameData.js

// Import necessary constants and types from the Node-SC2 core package
const { UnitType } = require('@node-sc2/core/constants');
const GameState = require('./gameState');
const { getTimeInSeconds } = require('./utils');

/**
 * A map of unit types to their possible upgrades.
 * This map is used to keep track of the available upgrades for different unit types.
 * 
 * @type {Map<UnitTypeId, UnitTypeId[]>}
 * 
 * @example
 * // Accessing the upgrades for a Command Center
 * const ccUpgrades = upgradeTypes.get(UnitType.COMMANDCENTER);
 * // ccUpgrades might be [UnitType.ORBITALCOMMAND, UnitType.PLANETARYFORTRESS]
 */
const upgradeTypes = new Map([
  [UnitType.COMMANDCENTER, [UnitType.ORBITALCOMMAND, UnitType.PLANETARYFORTRESS]],
  [UnitType.HATCHERY, [UnitType.LAIR]],
  // Add other unit types and their upgrades as needed
]);

/**
 * Calculates the time remaining for a unit to reach a specific tech level.
 * 
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
  const gameState = GameState.getInstance();
  const possibleTechUnits = gameState.countTypes.has(techRequirement) ? gameState.countTypes.get(techRequirement) : [techRequirement];
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

// Export the data and functions so they can be used by other modules
module.exports = {
  upgradeTypes,
  getTimeToTargetTech,
};
