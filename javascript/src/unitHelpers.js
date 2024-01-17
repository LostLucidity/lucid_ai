//@ts-check
"use strict";

// External library imports from '@node-sc2/core/constants'
const { UnitType, UnitTypeId } = require('@node-sc2/core/constants');
const { Race, Alliance, WeaponTargetType } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');

// Internal module imports for utility functions and configurations
const { getAbilityIdsForAddons, unitTypeData, saveAndGetUnitTypeData } = require('./gameData');
const GameState = require('./gameState');
const { getDistance } = require('./geometryUtils');
const { unitTypeTrainingAbilities, liftAndLandingTime, flyingTypesMapping, getUpgradeBonus } = require('./unitConfig');

/**
 * Calculate the time it takes for a unit with an add-on to lift off (if not already flying), move, and land.
 * @param {World} world - The current world state.
 * @param {Unit} unit - The unit to calculate the lift, land, and move time for.
 * @param {Point2D | undefined} targetPosition - The target position to move to. If undefined, it will be calculated.
 * @param {(world: World, unit: Unit) => Point2D | undefined} findBestPositionForAddOnFn - Function to find the best position for an add-on.
 * @returns {number} - The time in seconds it takes to lift off, move, and land.
 */
function calculateLiftLandAndMoveTime(world, unit, targetPosition = undefined, findBestPositionForAddOnFn) {
  const { data } = world;
  const { isFlying, pos, unitType } = unit; if (isFlying === undefined || pos === undefined || unitType === undefined) return Infinity;

  // Get movement speed data for a flying barracks
  const { movementSpeed } = data.getUnitTypeData(UnitType.BARRACKSFLYING); if (movementSpeed === undefined) return Infinity;
  const movementSpeedPerSecond = movementSpeed * 1.4;

  targetPosition = targetPosition || findBestPositionForAddOnFn(world, unit); // placeholder function, replace with your own logic
  if (!targetPosition) return Infinity;
  const distance = getDistance(pos, targetPosition); // placeholder function, replace with your own logic
  const timeToMove = distance / movementSpeedPerSecond;

  // If unit is already flying, don't account for the lift-off time
  const totalLiftAndLandingTime = (isFlying || flyingTypesMapping.has(unitType)) ? liftAndLandingTime : liftAndLandingTime * 2;

  return totalLiftAndLandingTime + timeToMove;
}

/**
 * Calculates the potential splash damage of a unit against a set of target unit types.
 * @param {UnitResource} units - Resource object containing unit data.
 * @param {UnitTypeId} unitType - The attacking unit's type.
 * @param {UnitTypeId[]} targetUnitTypes - Array of target unit types.
 * @returns {number} - Calculated splash damage value.
 */
const calculateSplashDamage = (units, unitType, targetUnitTypes) => {
  if (targetUnitTypes.length > 0) {
    if (unitType === UnitType.COLOSSUS) {
      let groundUnitsCount = 0;
      const totalGroundDiameter = targetUnitTypes.reduce((totalDiameter, unitType) => {
        const unitDataType = getUnitTypeData(units, unitType);
        if (!unitDataType.isFlying) {
          groundUnitsCount += 1;
          return totalDiameter + (unitDataType.radius * 2);
        } else { return totalDiameter; }
      }, 0);
      const splashDiameter = 2.8;
      const averageGroundDiameter = totalGroundDiameter / groundUnitsCount;
      const potentialSplashCount = splashDiameter / averageGroundDiameter;
      const splashCount = potentialSplashCount < groundUnitsCount ? potentialSplashCount : groundUnitsCount;
      return splashCount > 1 ? splashCount : 1;
    }
  }
  return 1;
}

/**
 * @param {World} world
 * @param {Unit[]} selfUnits
 * @param {Unit[]} enemyUnits
 * @returns {{timeToKill: number, timeToBeKilled: number}}
 */
function calculateTimeToKillUnits(world, selfUnits, enemyUnits) {
  if (selfUnits.length === 0) {
    return { timeToKill: Infinity, timeToBeKilled: 0 };
  }

  if (enemyUnits.length === 0) {
    return { timeToKill: 0, timeToBeKilled: Infinity };
  }

  const timeToKill = enemyUnits.reduce((timeToKill, threat) => {
    const { health, shield, unitType } = threat;
    if (health === undefined || shield === undefined || unitType === undefined) return timeToKill;
    const totalHealth = health + shield;
    const totalWeaponDPS = selfUnits.reduce((totalWeaponDPS, unit) => {
      const { unitType } = unit;
      if (unitType === undefined) return totalWeaponDPS;

      const enemyUnitTypes = enemyUnits.reduce((/** @type {UnitTypeId[]} */acc, threat) => {
        if (threat.unitType !== undefined) {
          acc.push(threat.unitType);
        }
        return acc;
      }, []);

      const weaponDPS = getWeaponDPS(world, unitType, Alliance.SELF, enemyUnitTypes);
      return totalWeaponDPS + weaponDPS;
    }, 0);

    const timeToKillCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToKill === Infinity) ? timeToKillCurrent : timeToKill + timeToKillCurrent;
  }, Infinity);

  const timeToBeKilled = selfUnits.reduce((timeToBeKilled, unit) => {
    const { health, shield, unitType } = unit;
    if (health === undefined || shield === undefined || unitType === undefined) return timeToBeKilled;
    const totalHealth = health + shield;
    const totalWeaponDPS = enemyUnits.reduce((totalWeaponDPS, threat) => {
      const { unitType } = threat;
      if (unitType === undefined) return totalWeaponDPS;

      // Filter out undefined unitTypes
      const selfUnitTypes = selfUnits.reduce((/** @type {UnitTypeId[]} */acc, unit) => {
        if (unit.unitType !== undefined) {
          acc.push(unit.unitType);
        }
        return acc;
      }, []);

      const weaponDPS = getWeaponDPS(world, unitType, Alliance.ENEMY, selfUnitTypes);
      return totalWeaponDPS + weaponDPS;
    }, 0);

    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);

  return { timeToKill, timeToBeKilled };
}

/**
 * Checks if a structure can lift off.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit can lift off.
 */
function canStructureLiftOff(unit) {
  return unit.availableAbilities().some(ability => groupTypes.liftingAbilities.includes(ability));
}

/**
 * Determines if a weapon can attack a specific unit type.
 * @param {UnitResource} units
 * @param {SC2APIProtocol.Weapon} weapon
 * @param {UnitTypeId} targetUnitType
 * @returns {boolean}
 **/
function canWeaponAttackType(units, weapon, targetUnitType) {
  const { isFlying } = getUnitTypeData(units, targetUnitType);
  return weapon.type === WeaponTargetType.ANY || (weapon.type === WeaponTargetType.GROUND && !isFlying) || (weapon.type === WeaponTargetType.AIR && isFlying || targetUnitType === UnitType.COLOSSUS);
}

/**
 * Calculates the average attribute bonus damage for a given weapon against a list of enemy unit types.
 * @param {DataStorage} data - Data storage object containing unit and weapon data.
 * @param {SC2APIProtocol.Weapon} weapon - The weapon to calculate bonus damage for.
 * @param {UnitTypeId[]} enemyUnitTypes - List of enemy unit types to calculate damage against.
 * @returns {number} - The average bonus damage of the weapon against the provided unit types.
 */
function getAttributeBonusDamageAverage(data, weapon, enemyUnitTypes) {
  const totalBonusDamage = enemyUnitTypes.reduce((previousValue, unitType) => {
    let damage = 0;
    weapon.damageBonus?.forEach(bonus => {
      const unitTypeData = data.getUnitTypeData(unitType);
      if (unitTypeData?.attributes?.find(attribute => attribute === bonus.attribute) && bonus.bonus !== undefined) {
        damage += bonus.bonus;
      }
    });
    return previousValue + damage;
  }, 0);

  return totalBonusDamage > 0 ? (totalBonusDamage / enemyUnitTypes.length) : 0;
}

/**
 * Retrieves and counts units of a specific type.
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
function getUnitTypeCount(world, unitType) {
  const { agent, data, resources } = world;
  const unitsResource = resources.get().units;
  // Use the getAll method to get all units
  const unitArray = unitsResource.getAll();

  const gameState = GameState.getInstance();
  const abilityIds = getAbilityIdsForAddons(data, unitType);
  // Pass the correct Unit[] to the function
  const unitsWithCurrentOrders = gameState.getUnitsWithCurrentOrders(unitArray, abilityIds);

  let count = unitsWithCurrentOrders.length;
  // Ensure unitTypes is always an array
  const unitTypes = gameState.countTypes.get(unitType) || [unitType];
  unitTypes.forEach(type => {
    let unitsToCount = unitsResource.getById(type);
    if (agent.race === Race.TERRAN) {
      const completed = type === UnitType.ORBITALCOMMAND ? 0.998 : 1;
      unitsToCount = unitsToCount.filter(unit =>
        unit.buildProgress !== undefined && unit.buildProgress >= completed
      );
    }
    count += unitsToCount.length;
  });

  return count;
}

/**
 * Retrieves detailed data for a specific unit type.
 * @param {UnitResource} units
 * @param {UnitTypeId} unitType
 * @returns {{ healthMax: number; isFlying: boolean; radius: number; shieldMax: number; weaponCooldownMax: number; }}
 */
function getUnitTypeData(units, unitType) {
  let data = unitTypeData[unitType];

  if (!data || !['healthMax', 'isFlying', 'radius', 'shieldMax', 'weaponCooldownMax'].every(property => Object.prototype.hasOwnProperty.call(data, property))) {
    // Fetch and save data if not present or incomplete
    data = saveAndGetUnitTypeData(units, unitType);
    unitTypeData[unitType] = data; // Update the unitTypeData store
  }

  // Ensure the returned data matches the expected structure
  return {
    healthMax: data.healthMax || 0,
    isFlying: data.isFlying || false,
    radius: data.radius || 0,
    shieldMax: data.shieldMax || 0,
    weaponCooldownMax: data.weaponCooldownMax || 0
  };
}

/**
 * @param {Unit} unit 
 * @returns {UnitTypeId | null}
 */
function getUnitBeingTrained(unit) {
  // Access the unit's orders, assuming they exist and are structured as an array
  const { orders } = unit;
  if (!orders || orders.length === 0) return null;

  // The training order should be the first order in the list
  const trainingOrder = orders[0];
  const { abilityId } = trainingOrder; if (abilityId === undefined) return null;

  // The target type of the training order should be the unit type being trained
  const unitBeingTrained = unitTypeTrainingAbilities.get(abilityId); if (unitBeingTrained === undefined) return null;

  return unitBeingTrained || null;
}


/**
 * Returns the unit type to build based on the given unit and add-on type.
 * @param {Unit} unit 
 * @param {Map<number, number>} flyingTypesMapping 
 * @param {UnitTypeId} addOnType 
 * @returns {UnitTypeId | undefined}
 */
function getUnitTypeToBuild(unit, flyingTypesMapping, addOnType) {
  if (unit.unitType === undefined || addOnType === undefined) {
    console.error("Undefined unit type or addOn type encountered in getUnitTypeToBuild.");
    return undefined;
  }

  const flyingType = flyingTypesMapping.get(unit.unitType);
  const baseUnitType = flyingType !== undefined ? flyingType : unit.unitType;

  // Using the keys as strings
  const baseTypeKey = baseUnitType.toString();
  const addOnTypeKey = addOnType.toString();

  /** @type {{ [key: string]: string }} */
  const castedUnitTypeId = /** @type {*} */ (UnitTypeId);

  // Check if keys exist in UnitTypeId using Object.prototype.hasOwnProperty
  if (Object.prototype.hasOwnProperty.call(castedUnitTypeId, baseTypeKey) && Object.prototype.hasOwnProperty.call(castedUnitTypeId, addOnTypeKey)) {
    // Construct the unit type string
    const unitTypeString = `${castedUnitTypeId[baseTypeKey]}${castedUnitTypeId[addOnTypeKey]}`;

    /** @type {{ [key: string]: number }} */
    const castedUnitType = /** @type {*} */ (UnitType);

    return castedUnitType[unitTypeString];
  }

  return undefined;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Alliance} alliance
 * @param {UnitTypeId[]} enemyUnitTypes
 * @returns {number}
 */
const getWeaponDPS = (world, unitType, alliance, enemyUnitTypes) => {
  const { data, resources } = world;
  const { units } = resources.get();
  const { weapons } = data.getUnitTypeData(unitType);
  if (weapons === undefined) return 0;
  const gameState = GameState.getInstance();
  const weaponsDPS = weapons.map(weapon => {
    const weaponAverageDPSAgainstTypes = enemyUnitTypes.reduce((totalDPS, enemyUnitType) => {
      const { attacks, damage, speed } = weapon;
      if (!attacks || !damage || !speed) return totalDPS;
      if (canWeaponAttackType(units, weapon, enemyUnitType)) {
        // Check if weapon.damage is defined, and handle the undefined case
        if (typeof weapon.damage !== 'number') {
          // Handle the undefined case, e.g., skip the current iteration or use a default value
          return totalDPS;
        }

        // Continue with calculation since weapon.damage is defined
        const weaponUpgradeDamage = damage + (gameState.getAttackUpgradeLevel(alliance) * getUpgradeBonus(alliance, weapon.damage));
        const weaponBonusDamage = getAttributeBonusDamageAverage(data, weapon, [enemyUnitType]);
        const weaponDamage = weaponUpgradeDamage - gameState.getArmorUpgradeLevel(alliance) + weaponBonusDamage;
        const weaponSplashDamage = calculateSplashDamage(units, unitType, enemyUnitTypes);
        return totalDPS + (weaponDamage * attacks * weaponSplashDamage) / (speed / 1.4);
      }
      return totalDPS;
    }, 0);
    return weaponAverageDPSAgainstTypes / enemyUnitTypes.length;
  });
  // return max of weaponsDPS, if no value found in weaponsDPS, return 0
  if (weaponsDPS.length === 0) return 0;
  return Math.max.apply(Math, weaponsDPS);
}

/**
 * Checks if a structure is lifted.
 * @param {Unit} unit The unit to check.
 * @returns {boolean} Returns true if the unit is lifted.
 */
function isStructureLifted(unit) {
  return unit.availableAbilities().some(ability => groupTypes.landingAbilities.includes(ability));
}

/**
 * Checks if a unit is currently training another unit.
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @returns {boolean}
 */
const isTrainingUnit = (data, unit) => {
  // Return false if unit.orders is undefined
  if (!unit.orders) {
    return false;
  }

  /** @type {{ [key: string]: number }} */
  const castedUnitType = /** @type {*} */ (UnitType);

  return unit.orders.some(order => {
    return Object.keys(castedUnitType).some(key => order.abilityId === data.getUnitTypeData(castedUnitType[key]).abilityId);
  });
};

/**
 * Determines if a unit is potentially a combatant.
 * @param {Unit} unit - Unit to check.
 * @returns {boolean} - True if unit has potential for combat, otherwise false.
 */
function potentialCombatants(unit) {
  return unit.isCombatUnit() || unit.unitType === UnitType.QUEEN || (unit.isWorker() && !unit.isHarvesting());
}

/**
 * Sets a reposition label on a unit with a specified position.
 * @param {Unit} unit The unit to set the label on.
 * @param {Point2D} position The position to set as the label.
 */
const setRepositionLabel = (unit, position) => {
  unit.labels.set('reposition', position);
  console.log('reposition', position);
};

/**
 * Returns updated addOnType using countTypes.
 * @param {UnitTypeId} addOnType 
 * @param {Map<UnitTypeId, UnitTypeId[]>} countTypes 
 * @returns {UnitTypeId}
 */
function updateAddOnType(addOnType, countTypes) {
  for (const [key, value] of countTypes.entries()) {
    if (value.includes(addOnType)) {
      return key;
    }
  }
  return addOnType;
}

// Export the shared functions
module.exports = {
  calculateLiftLandAndMoveTime,
  calculateTimeToKillUnits,
  canStructureLiftOff,
  getUnitTypeCount,
  getUnitTypeToBuild,
  getUnitBeingTrained,
  isStructureLifted,
  isTrainingUnit,
  potentialCombatants,
  setRepositionLabel,
  updateAddOnType,
};
