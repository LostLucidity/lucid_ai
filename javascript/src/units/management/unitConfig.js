//@ts-check
'use strict';

// Core library imports
const { UnitType, WarpUnitAbility } = require('@node-sc2/core/constants');
const { Alliance } = require('@node-sc2/core/constants/enums');

// Internal module imports
const { GameState } = require('../../gameState');

/**
 * Mapping of unit types to their possible addon types.
 * @type {Map<number, number[]>}
 */
const addOnTypesMapping = new Map([
  [UnitType.BARRACKS, [UnitType.BARRACKSREACTOR, UnitType.BARRACKSTECHLAB]],
  [UnitType.FACTORY, [UnitType.FACTORYREACTOR, UnitType.FACTORYTECHLAB]],
  [UnitType.STARPORT, [UnitType.STARPORTREACTOR, UnitType.STARPORTTECHLAB]],
]);

/** 
 * The time it takes for a unit with an add-on to lift off and land.
 * Calculated based on game data.
 * @type number 
 */
const liftAndLandingTime = 64 / 22.4;

/** @type {Map<number, number>} */
const unitTypeTrainingAbilities = new Map();

/**
 * Mapping of unit types to their flying counterparts.
 * @type {Map<number, number>}
 */
const flyingTypesMapping = new Map([
  [UnitType.COMMANDCENTERFLYING, UnitType.COMMANDCENTER],
  [UnitType.BARRACKSFLYING, UnitType.BARRACKS],
  [UnitType.FACTORYFLYING, UnitType.FACTORY],
  [UnitType.STARPORTFLYING, UnitType.STARPORT],
]);

// Initialize the map for caching movement speeds by unit type
/** @type Map<number, number> */
const movementSpeedByType = new Map();

/**
 * Movement speed bonuses for Zerg units on creep.
 * @type {Map<UnitTypeId, number>}
 */
const ZERG_UNITS_ON_CREEP_BONUS = new Map([
  [UnitType.QUEEN, 2.67],
  [UnitType.LOCUSTMP, 1.4],
  [UnitType.SPORECRAWLER, 1.5],
  [UnitType.SPINECRAWLER, 1.5],
]);

/**
 * Retrieves the movement speed of a unit based on its type.
 * @param {Unit} unit The unit for which to get the movement speed.
 * @returns {number | undefined} The movement speed of the unit, if available.
 */
const getMovementSpeedByType = (unit) => {
  const { unitType } = unit;
  if (unitType === undefined) return undefined;

  // Use cached value if available to avoid repeated calculations
  if (movementSpeedByType.has(unitType)) {
    return movementSpeedByType.get(unitType);
  }

  // Retrieve and cache movement speed if it's not already done
  const movementSpeed = unit.data()?.movementSpeed;
  if (movementSpeed !== undefined) {
    movementSpeedByType.set(unitType, movementSpeed);
  }

  return movementSpeed;
};

/**
 * Check if a unit type can construct an addon.
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function canUnitBuildAddOn(unitType) {
  const { BARRACKS, FACTORY, STARPORT } = UnitType;
  const gameState = GameState.getInstance();
  const addonConstructingUnits = [
    ...(gameState.countTypes.get(BARRACKS) || []), ...(addOnTypesMapping.get(BARRACKS) || []),
    ...(gameState.countTypes.get(FACTORY) || []), ...(addOnTypesMapping.get(FACTORY) || []),
    ...(gameState.countTypes.get(STARPORT) || []), ...(addOnTypesMapping.get(STARPORT) || []),
  ];
  return addonConstructingUnits.includes(unitType);
}

/**
 * Checks if a unit can lift off.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} True if the unit can lift off, false otherwise.
 */
function canLiftOff(unit) {
  const { unitType } = unit;
  if (unitType === undefined) return false;
  // The unit types that can lift off
  const typesThatCanLiftOff = new Set([UnitType.COMMANDCENTER, UnitType.BARRACKS, UnitType.FACTORY, UnitType.STARPORT]);

  return typesThatCanLiftOff.has(unitType);
}

/**
 * Calculates the upgrade bonus for damage based on the alliance.
 * @param {Alliance} alliance - The alliance (SELF or ENEMY) to calculate the bonus for.
 * @param {number} damage - The base damage value.
 * @returns {number} - The calculated upgrade bonus.
 */
function getUpgradeBonus(alliance, damage) {
  if (alliance === Alliance.SELF) {
    // Logic for calculating bonus for self alliance
    return 0; // Adjust this according to your game's logic
  } else if (alliance === Alliance.ENEMY) {
    // Logic for calculating bonus for enemy alliance
    const roundedDamage = Math.round(damage / 10);
    return roundedDamage > 0 ? roundedDamage : 1;
  }

  // Fallback return statement
  return 0; // Or any other default value you deem appropriate
}

/**
 * Initializes the mapping of unit type training abilities.
 * This function populates the `unitTypeTrainingAbilities` map with mappings from unit ability IDs to unit type IDs.
 * It iterates over all unit types, retrieves their associated ability ID from the game data,
 * and sets the mapping in the `unitTypeTrainingAbilities` map.
 * Additionally, it checks and sets mappings for WarpUnitAbility if available.
 * 
 * @param {DataStorage} data - The game data storage, containing unit type data and abilities.
 */
function setUnitTypeTrainingAbilityMapping(data) {
  Array.from(Object.values(UnitType)).forEach(unitTypeId => {
    const unitData = data.getUnitTypeData(unitTypeId);
    if (unitData && unitData.abilityId !== undefined) {
      unitTypeTrainingAbilities.set(unitData.abilityId, unitTypeId);
    }

    // Assume WarpUnitAbility is defined elsewhere in the context
    if (WarpUnitAbility[unitTypeId]) {
      unitTypeTrainingAbilities.set(WarpUnitAbility[unitTypeId], unitTypeId);
    }
  });
}

// Export the mappings, configurations, and functions
module.exports = {
  addOnTypesMapping,
  flyingTypesMapping,
  liftAndLandingTime,
  ZERG_UNITS_ON_CREEP_BONUS,
  getMovementSpeedByType,
  unitTypeTrainingAbilities,
  canUnitBuildAddOn,
  canLiftOff,
  getUpgradeBonus,
  setUnitTypeTrainingAbilityMapping,
};
