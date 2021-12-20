//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const unitResourceService = require("../systems/unit-resource/unit-resource-service");
const planService = require("./plan-service");
const { getArmorUpgradeLevel, getAttackUpgradeLevel } = require("./units-service");

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
   * @param {UnitTypeId[]} unitTypes
   * @param {Alliance} alliance
   * @param {Unit[]} enemyUnits 
   * @returns {number}
   */
  calculateDPSHealthOfTrainingUnits: (data, unitTypes, alliance, enemyUnits) => {
    return unitTypes.reduce((totalDPSHealth, unitType) => {
      if (workerTypes.includes(unitType)) {
        return totalDPSHealth;
      } else {
        return totalDPSHealth + dataService.getDPSHealthOfTrainingUnit(data, unitType, alliance, enemyUnits);
      }
    }, 0);
  },
  /**
   * Calculate DPS health base on ally units and enemy armor upgrades.
   * @param {DataStorage} data 
   * @param {Unit[]} units
   * @param {UnitTypeId[]} enemyUnitTypes 
   * @returns {number}
   */
  calculateNearDPSHealth: (data, units, enemyUnitTypes) => {
    return units.reduce((accumulator, unit) => {
      if (unit.isWorker() && unit.isHarvesting()) {
        return accumulator;
      } else {
        return accumulator + dataService.getDPSHealth(data, unit, enemyUnitTypes);
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
   * @param {UnitTypeId[]} enemyUnitTypes
   * @returns number
   */
  getAttributeBonusDamageAverage: (data, weapon, enemyUnitTypes) => {
    const totalBonusDamage = enemyUnitTypes.reduce((previousValue, unitType) => {
      let damage = 0;
      weapon.damageBonus.forEach(bonus => {
        if (data.getUnitTypeData(unitType).attributes.find(attribute => attribute === bonus.attribute)) {
          damage += bonus.bonus;
        }
      });
      return previousValue + damage;
    }, 0);
    return totalBonusDamage > 0 ? (totalBonusDamage / enemyUnitTypes.length) : 0;
  },
  /**
   * @param {DataStorage} data 
   * @param {Unit} unit
   * @param {UnitTypeId[]} enemyUnitTypes 
   */
  getDPSHealth: (data, unit, enemyUnitTypes) => {
    const weapon = data.getUnitTypeData(unit.unitType).weapons[0];
    let dPSHealth = 0;
    if (weapon) {
      const weaponUpgradeDamage = weapon.damage + (unit.attackUpgradeLevel * dataService.getUpgradeBonus(unit.alliance, weapon.damage));
      const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyUnitTypes);
      const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(unit.alliance) + weaponBonusDamage;
      dPSHealth = weaponDamage / weapon.speed * (unit.health + unit.shield);
    }
    return dPSHealth;
  },
  /**
   * @param {DataStorage} data 
   * @param {UnitTypeId} unitType
   * @param {Alliance} alliance
   * @param {Unit[]} enemyUnits 
   */
  getDPSHealthOfTrainingUnit: (data, unitType, alliance, enemyUnits) => {
    const weapon = data.getUnitTypeData(unitType).weapons[0];
    let dPSHealth = 0;
    if (weapon) {
      const weaponUpgradeDamage = weapon.damage + (getAttackUpgradeLevel(alliance) * dataService.getUpgradeBonus(alliance, weapon.damage));
      const weaponBonusDamage = dataService.getAttributeBonusDamageAverage(data, weapon, enemyUnits.map(enemyUnit => enemyUnit.unitType));
      const weaponDamage = weaponUpgradeDamage - getArmorUpgradeLevel(alliance) + weaponBonusDamage;
      const { healthMax, shieldMax } = unitResourceService.unitTypeData[unitType]
      dPSHealth = weaponDamage / weapon.speed * (healthMax + shieldMax);
    }
    return dPSHealth;
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
   * @param {number} alliance 
   * @param {number} damage 
   * @returns {number}
   */
  getUpgradeBonus: (alliance, damage) => {
    if (alliance === Alliance.SELF) {
      return 0;
    } else if (alliance === Alliance.ENEMY) {
      // divide damage by 10, round, min 1.
      const roundedDamage = Math.round(damage / 10);
      return roundedDamage > 0 ? roundedDamage : 1;
    }
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