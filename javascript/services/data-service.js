//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const planService = require("./plan-service");
const { getArmorUpgradeLevel } = require("./units-service");

const dataService = {
  /**
   * 
   * @param {World['data']} data 
   * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
   */
  addEarmark: (data, orderData) => {
    data.addEarmark({
      name: `${planService.currentStep}`,
      minerals: orderData.mineralCost,
      vespene: orderData.vespeneCost,
    });
  },
  /**
   * Calculate DPS health base on ally units and enemy armor upgrades.
   * @param {DataStorage} data 
   * @param {Unit[]} units
   * @param {Unit[]} enemyUnits 
   * @returns {number}
   */
  calculateNearDPSHealth: (data, units, enemyUnits) => {
    return units.reduce((accumulator, unit) => {
      let dPSHealth = 0;
      if (unit.isWorker() && unit.isHarvesting()) {
        return accumulator;
      } else {
        const weapon = data.getUnitTypeData(unit.unitType).weapons[0];
        if (weapon) {
          const weaponUpgradeDamage = weapon.damage + (unit.attackUpgradeLevel * getUpgradeBonus(unit.alliance, weapon.damage));
          const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyUnits);
          const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(enemyUnits) + weaponBonusDamage;
          dPSHealth = weaponDamage / weapon.speed * (unit.health + unit.shield);
        }
        return accumulator + dPSHealth;
      }
    }, 0);
  },
  /**
   * 
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   */
  calculateNearSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  },
  /**
   * @param {DataStorage} data
   * @param {SC2APIProtocol.Weapon} weapon 
   * @param {Unit[]} enemyUnits
   * @returns number
   */
  getAttributeBonusDamageAverage: (data, weapon, enemyUnits) => {
    const totalBonusDamage = enemyUnits.reduce((previousValue, unit) => {
      let damage = 0;
      weapon.damageBonus.forEach(bonus => {
        if (data.getUnitTypeData(unit.unitType).attributes.find(attribute => attribute === bonus.attribute)) {
          damage += bonus.bonus;
        }
      });
      return previousValue + damage;
    }, 0);
    return totalBonusDamage > 0 ? (totalBonusDamage / enemyUnits.length) : 0;
  },
  /**
   * 
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   */
  getDPSHealth: (data, units) => {
    return units.reduce((accumulator, unit) => {
      const weapon = data.getUnitTypeData(unit.unitType).weapons[0];
      let dPSHealth = 0;
      if (weapon) {
        dPSHealth = weapon.damage / weapon.speed * (unit.health + unit.shield);
      }
      return accumulator + dPSHealth;
    }, 0);
  },
  /**
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   * @returns {number}
   */
  getSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  },
  /**
   * @param {DataStorage} data 
   * @param {Unit[]} units
   * @param {Unit[]} enemyUnits 
   */
  setEnemySupplyPowers: (data, units, enemyUnits) => {
    units.forEach(unit => {
      unit['enemyUnits'] = enemyUnits.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16)
      unit['enemySupply'] = dataService.calculateNearSupply(data, unit['enemyUnits']);
    });
  },
  /**
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   */
  setSelfSupplyPowers: (data, units) => {
    units.forEach(unit => {
      unit['selfUnits'] = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['selfSupply'] = dataService.calculateNearSupply(data, unit['selfUnits']);
    });
  },
}

module.exports = dataService

/**
 * @param {number} alliance 
 * @param {number} damage 
 * @returns {number}
 */
function getUpgradeBonus(alliance, damage) {
  if (alliance === Alliance.SELF) {
    return 0;
  } else if (alliance === Alliance.ENEMY) {
    // divide damage by 10, round, min 1.
    const roundedDamage = Math.round(damage / 10);
    return roundedDamage > 0 ? roundedDamage : 1;
  }
}