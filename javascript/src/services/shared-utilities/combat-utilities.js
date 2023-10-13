// combat-utilities.js

// eslint-disable-next-line no-unused-vars
const { Alliance, WeaponTargetType } = require("@node-sc2/core/constants/enums");
const unitService = require("../../../services/unit-service");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");
const dataService = require("../../../services/data-service");
const { UnitType } = require("@node-sc2/core/constants");
const { getDistance } = require("../../../services/position-service");
const { canAttack } = require("../../../services/resources-service");

let damageByTag = {};
let lastUpdatedStep = -1;  // A value that indicates it hasn't been updated yet.

/**
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit[]}
 */
const filterEnemyUnits = (unit, enemyUnits) => {
  const { pos } = unit; if (pos === undefined) return [];
  return enemyUnits.filter(enemyUnit => {
    const { pos: enemyPos } = enemyUnit;
    if (enemyPos === undefined) return false;
    return !(enemyUnit.unitType === UnitType.LARVA) && getDistance(enemyPos, pos) < 16 && canAttack(unit, enemyUnit, false);
  });
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Alliance} alliance
 * @param {UnitTypeId[]} enemyUnitTypes
 * @returns {number}
*/
const getWeaponDPS = (world, unitType, alliance, enemyUnitTypes) => {
  const { getArmorUpgradeLevel, getAttackUpgradeLevel } = unitService;
  const { calculateSplashDamage } = unitResourceService;
  const { data, resources } = world;
  const { units } = resources.get();
  const { weapons } = data.getUnitTypeData(unitType);
  if (weapons === undefined) return 0;
  const weaponsDPS = weapons.map(weapon => {
    const weaponAverageDPSAgainstTypes = enemyUnitTypes.reduce((totalDPS, enemyUnitType) => {
      const { attacks, damage, speed } = weapon;
      if (!attacks || !damage || !speed) return totalDPS;
      if (canWeaponAttackType(units, weapon, enemyUnitType)) {
        const weaponUpgradeDamage = damage + (getAttackUpgradeLevel(alliance) * dataService.getUpgradeBonus(alliance, weapon.damage));
        const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, [enemyUnitType]);
        const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(alliance) + weaponBonusDamage;
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
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {SC2APIProtocol.Weapon | undefined}
 **/
const getWeapon = (data, unit, targetUnit) => {
  const { getWeaponThatCanAttack } = unitService;
  const { unitType } = unit;
  if (!unitType) return undefined;
  if (unitType === UnitType.SENTRY) {
    return {
      attacks: 1,
      damage: 6,
      damageBonus: [],
      range: 5,
      speed: 1,
      type: WeaponTargetType.ANY,
    }
  } else {
    return getWeaponThatCanAttack(data, unitType, targetUnit);
  }
};

/**
 * Sets the cumulative damage for a given unit tag and game step.
 *
 * @param {string | number} tag - The tag identifier of the unit.
 * @param {number} damage - The damage dealt to the unit.
 * @param {number} currentStep - The current game step.
 */
const setDamageForTag = (tag, damage, currentStep) => {
  if (lastUpdatedStep !== currentStep) {
    resetDamageByTag();
    lastUpdatedStep = currentStep;
  }

  // Accumulate damage for the tag
  if (Object.prototype.hasOwnProperty.call(damageByTag, tag)) {
    damageByTag[tag] += damage;
  } else {
    damageByTag[tag] = damage;
  }
};

/**
 * @param {string | number} tag
 * @param {number} currentStep
 */
const getDamageForTag = (tag, currentStep) => {
  if (lastUpdatedStep !== currentStep) {
    resetDamageByTag();
    lastUpdatedStep = currentStep;
  }
  return damageByTag[tag];
};


const resetDamageByTag = () => {
  damageByTag = {};
};

/**
 * Get the raw damage value for a single attack from one type of unit against another.
 *
 * @param {World} world - The game state or environment.
 * @param {number} attackingUnitType - The unit type ID of the attacking unit.
 * @param {Unit} target - The target unit.
 * @returns {number} - The damage per hit, accounting for multiple attacks, damage bonuses, and armor if applicable. Returns 0 if no valid weapon can attack the target unit types.
 */
const getWeaponDamage = (world, attackingUnitType, target) => {
  const { data } = world;

  /** @type {SC2APIProtocol.Weapon | undefined} */
  const weaponThatCanAttack = unitService.getWeaponThatCanAttack(data, attackingUnitType, target);

  if (weaponThatCanAttack) {
    let rawDamage = weaponThatCanAttack.damage || 0;
    const numberOfAttacks = weaponThatCanAttack.attacks || 1;
    const targetUnitType = target.unitType;
    // Account for any damage bonuses
    if (weaponThatCanAttack.damageBonus) {
      const targetAttributes = data.getUnitTypeData(targetUnitType).attributes || [];
      for (const damageBonus of weaponThatCanAttack.damageBonus) {
        if (damageBonus.attribute && targetAttributes.includes(damageBonus.attribute)) {
          rawDamage += (damageBonus.bonus || 0);
          break;
        }
      }
    }

    // Account for enemy armor
    const targetAlliance = target.alliance;
    const armorUpgradeLevel = unitService.getArmorUpgradeLevel(targetAlliance);
    const armor = data.getUnitTypeData(targetUnitType).armor || 0;
    const effectiveArmor = armor + armorUpgradeLevel;
    rawDamage = Math.max(0, rawDamage - effectiveArmor);

    // Calculate total damage accounting for the number of attacks
    return rawDamage * numberOfAttacks;
  }

  return 0; // Return 0 if no valid weapon can attack the target unit types
};

// Exporting the functions using module.exports
module.exports = {
  filterEnemyUnits,
  getWeaponDPS,
  getWeapon,
  setDamageForTag,
  getDamageForTag,
  getWeaponDamage
};


/**
 * @param {UnitResource} units
 * @param {SC2APIProtocol.Weapon} weapon
 * @param {UnitTypeId} targetUnitType
 * @returns {boolean}
 **/
function canWeaponAttackType(units, weapon, targetUnitType) {
  const { getUnitTypeData } = unitResourceService;
  const { isFlying } = getUnitTypeData(units, targetUnitType);
  return weapon.type === WeaponTargetType.ANY || (weapon.type === WeaponTargetType.GROUND && !isFlying) || (weapon.type === WeaponTargetType.AIR && isFlying || targetUnitType === UnitType.COLOSSUS);
}