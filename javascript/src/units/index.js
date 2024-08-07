const { UnitType, } = require("@node-sc2/core/constants");
// eslint-disable-next-line no-unused-vars
const { WeaponTargetType, Alliance } = require("@node-sc2/core/constants/enums");

const { getUpgradeBonus } = require("./management/unitConfig");
const { unitTypeData, saveAndGetUnitTypeData } = require("../../data/gameData/gameData");
const { GameState } = require("../gameState");

/**
 * Calculates the potential splash damage of a unit against a set of target unit types.
 * @param {UnitResource} units - Resource object containing unit data.
 * @param {UnitTypeId} unitType - The attacking unit's type.
 * @param {UnitTypeId[]} targetUnitTypes - Array of target unit types.
 * @returns {number} - Calculated splash damage value.
 */
function calculateSplashDamage(units, unitType, targetUnitTypes) {
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
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Alliance} alliance
 * @param {UnitTypeId[]} enemyUnitTypes
 * @returns {number}
 */
function getWeaponDPS(world, unitType, alliance, enemyUnitTypes) {
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
 * Determines if a unit is potentially a combatant.
 * @param {Unit} unit - Unit to check.
 * @returns {boolean} - True if unit has potential for combat, otherwise false.
 */
function potentialCombatants(unit) {
  return unit.isCombatUnit() || unit.unitType === UnitType.QUEEN || (unit.isWorker() && !unit.isHarvesting());
}

module.exports = {
  calculateSplashDamage,
  canWeaponAttackType,
  getAttributeBonusDamageAverage,
  getWeaponDPS,
  potentialCombatants,
};