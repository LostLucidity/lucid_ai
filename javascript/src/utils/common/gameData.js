//@ts-check
"use strict";

// src/gameData.js

/**
 * Extended unit type data including additional fields specific to your application.
 * This type builds upon SC2APIProtocol.UnitTypeData by adding more fields.
 * @typedef {Object} ExtendedUnitTypeData
 * @property {number} [healthMax] - Maximum health of the unit.
 * @property {boolean} [isFlying] - Indicates if the unit is flying.
 * @property {number} [radius] - The radius of the unit.
 * @property {number} [shieldMax] - Maximum shield of the unit.
 * @property {number} [weaponCooldownMax] - Maximum weapon cooldown.
 */

// External library imports
const { UnitType } = require('@node-sc2/core/constants');
const { reactorTypes, techLabTypes } = require('@node-sc2/core/constants/groups');

// Internal module imports
const { getTimeInSeconds } = require('./utils');
const GameState = require('../../core/gameState');

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
]);

/** @type {{ [unitTypeId: number]: ExtendedUnitTypeData }} */
const unitTypeData = {};

/**
 * Builds a map from unit names to their ability IDs.
 * @param {DataStorage} dataStorage
 * @returns {import('./common').UnitTypeMap}
 */
function buildUnitTypeMap(dataStorage) {
  /** @type {import('./common').UnitTypeMap} */
  const map = {};

  const allUnitTypeIds = getAllUnitTypeIds(); // Implement this function

  allUnitTypeIds.forEach(id => {
    const data = dataStorage.getUnitTypeData(id);
    if (data && data.name && data.abilityId !== undefined) {
      map[data.name] = data.abilityId;
    }
  });

  return map;
}

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
 * Returns a list of all unit type IDs.
 * @returns {number[]}
 */
function getAllUnitTypeIds() {
  return Object.values(UnitType);
}

/**
 * Retrieves the ability IDs for reactor types.
 * @param {DataStorage} data
 * @returns {AbilityId[]}
 */
function getReactorAbilities(data) {
  /** @type {AbilityId[]} */
  const reactorAbilities = [];
  reactorTypes.forEach(type => {
    const unitTypeData = data.getUnitTypeData(type);
    if (unitTypeData && unitTypeData.abilityId !== undefined) {
      reactorAbilities.push(unitTypeData.abilityId);
    }
  });
  return reactorAbilities;
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
 * Retrieves ability IDs associated with Tech Labs.
 * 
 * @param {DataStorage} data 
 * @returns {AbilityId[]}
 */
function getTechlabAbilities(data) {
  /** @type {AbilityId[]} */
  const techlabAbilities = [];
  techLabTypes.forEach(type => {
    const unitTypeData = data.getUnitTypeData(type);
    if (unitTypeData && unitTypeData.abilityId !== undefined) {
      techlabAbilities.push(unitTypeData.abilityId);
    }
  });
  return techlabAbilities;
}

/**
 * Retrieves data for a specific unit type.
 * @param {UnitTypeId} unitTypeId
 * @returns {ExtendedUnitTypeData}
 */
function getUnitTypeData(unitTypeId) {
  return unitTypeData[unitTypeId];
}

/**
 * Retrieves unit types that correspond to given ability IDs.
 * 
 * @param {DataStorage} data 
 * @param {AbilityId[]} abilityIds
 * @returns {UnitTypeId[]}
 */
function getUnitTypesWithAbilities(data, abilityIds) {
  /** @type {UnitTypeId[]} */
  const unitTypesWithAbilities = [];
  abilityIds.forEach(abilityId => {
    const unitTypes = data.findUnitTypesWithAbility(abilityId);
    if (unitTypes && unitTypes.length > 0) {
      unitTypesWithAbilities.push(...unitTypes);
    }
  });
  return unitTypesWithAbilities;
}

/**
 * Retrieves detailed data for a specific unit type and saves it if not already present.
 * @param {UnitResource} units
 * @param {UnitTypeId} unitType
 * @returns {ExtendedUnitTypeData}
 */
function saveAndGetUnitTypeData(units, unitType) {
  const [unit] = units.getByType(unitType);
  if (unit) {
    const { healthMax, isFlying, radius, shieldMax, weaponCooldown } = unit;
    const weaponCooldownMax = weaponCooldown;

    // Construct the object with only existing properties
    const dataToSave = {
      healthMax: healthMax !== undefined ? healthMax : undefined,
      isFlying: isFlying !== undefined ? isFlying : undefined,
      radius: radius !== undefined ? radius : undefined,
      shieldMax: shieldMax !== undefined ? shieldMax : undefined,
      weaponCooldownMax: weaponCooldownMax !== undefined ? weaponCooldownMax : undefined,
    };

    unitTypeData[unitType] = dataToSave;
    return dataToSave;
  } else {
    return unitTypeData[unitType] || undefined;
  }
}

/**
 * Updates or adds data for a specific unit type.
 * @param {UnitTypeId} unitTypeId
 * @param {ExtendedUnitTypeData} data
 */
function setUnitTypeData(unitTypeId, data) {
  unitTypeData[unitTypeId] = data;
}

// Export the data and functions so they can be used by other modules
module.exports = {
  upgradeTypes,
  unitTypeData,
  buildUnitTypeMap,
  getTimeToTargetTech,
  getAbilityIdsForAddons,
  getUnitTypeData,
  getUnitTypesWithAbilities,
  saveAndGetUnitTypeData,
  setUnitTypeData,
};
