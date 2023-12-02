//@ts-check
"use strict";

// src/gameData.js

// External library imports
const { UnitType } = require('@node-sc2/core/constants');
const { reactorTypes, techLabTypes } = require('@node-sc2/core/constants/groups');

// Internal module imports
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
 * Retrieves the ability IDs for unit addons.
 * @param {DataStorage} data
 * @param {UnitTypeId} unitType
 * @returns {AbilityId[]}
 */
function getAbilityIdsForAddons(data, unitType) {
  let { abilityId } = data.getUnitTypeData(unitType);
  let abilityIds = [];

  if (abilityId === 1674) { // Assuming these are constant values representing specific addons
    abilityIds.push(...getReactorAbilities(data));
  } else if (abilityId === 1666) {
    abilityIds.push(...getTechlabAbilities(data));
  } else if (abilityId !== undefined) {
    abilityIds.push(abilityId);
  }

  return abilityIds;
}

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

/**
 * Retrieves the ability IDs for reactor types.
 * @param {DataStorage} data
 * @returns {AbilityId[]}
 */
function getReactorAbilities(data) {
  const reactorAbilities = [];
  reactorTypes.forEach(type => {
    reactorAbilities.push(data.getUnitTypeData(type).abilityId);
  });
  return reactorAbilities;
}

/**
 * Retrieves ability IDs associated with Tech Labs.
 * 
 * @param {DataStorage} data 
 * @returns {AbilityId[]}
 */
function getTechlabAbilities(data) {
  const techlabAbilities = [];
  techLabTypes.forEach(type => {
    techlabAbilities.push(data.getUnitTypeData(type).abilityId);
  });
  return techlabAbilities;
}

/**
 * Retrieves unit types that correspond to given ability IDs.
 * 
 * @param {DataStorage} data 
 * @param {AbilityId[]} abilityIds
 * @returns {UnitTypeId[]}
 */
function getUnitTypesWithAbilities(data, abilityIds) {
  const unitTypesWithAbilities = [];
  abilityIds.forEach(abilityId => {
    unitTypesWithAbilities.push(...data.findUnitTypesWithAbility(abilityId));
  });
  return unitTypesWithAbilities;
}

// Export the data and functions so they can be used by other modules
module.exports = {
  upgradeTypes,
  getTimeToTargetTech,
  getAbilityIdsForAddons,
  getUnitTypesWithAbilities,
};
