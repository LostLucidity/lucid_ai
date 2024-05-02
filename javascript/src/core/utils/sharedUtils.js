// src/utils/sharedUtils.js

const { Alliance } = require("@node-sc2/core/constants/enums");

/**
 * Calculates the time to kill between self units and enemy units,
 * using a function to get the Weapon DPS.
 * 
 * @param {World} world The world context.
 * @param {Unit[]} selfUnits The units on the player's side.
 * @param {Unit[]} enemyUnits The enemy units.
 * @param {(world: World, unitType: UnitTypeId, alliance: Alliance, enemyUnitTypes: UnitTypeId[]) => number} getWeaponDPSFunc Function to calculate weapon DPS.
 * @returns {{ timeToKill: number, timeToBeKilled: number }}
 */
function calculateTimeToKillUnits(world, selfUnits, enemyUnits, getWeaponDPSFunc) {

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

      const weaponDPS = getWeaponDPSFunc(world, unitType, Alliance.SELF, enemyUnitTypes);
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

      const weaponDPS = getWeaponDPSFunc(world, unitType, Alliance.ENEMY, selfUnitTypes);
      return totalWeaponDPS + weaponDPS;
    }, 0);

    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);

  return { timeToKill, timeToBeKilled };
}

module.exports = { calculateTimeToKillUnits };
