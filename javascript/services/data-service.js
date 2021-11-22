//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const planService = require("./plan-service");

const dataService = {
  /**
   * @type number
   */
  enemyArmorUpgradeLevel: 0,
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
   * 
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   * @returns {number}
   */
   calculateNearDPSHealth: (data, units) => {
    enemyTrackingService.mappedEnemyUnits.some(unit => {
      if (unit.armorUpgradeLevel > dataService.enemyUpgradeLevel) {
        dataService.enemyUpgradeLevel = unit.armorUpgradeLevel;
        return true;
      }
    })
    return units.reduce((accumulator, unit) => {
      let dPSHealth = 0;
      if (unit.isWorker() && unit.isHarvesting()) {
        return accumulator;
      } else {
        const weapon = data.getUnitTypeData(unit.unitType).weapons[0];
        if (weapon) {
          const weaponDamage = weapon.damage - dataService.enemyArmorUpgradeLevel;
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
   * @param {Unit[]} enemyUnits 
   */   
  setEnemyDPSHealthPower: (data, units, enemyUnits) => {
    units.forEach(unit => {
      unit['enemyUnits'] = enemyUnits.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16)
      unit['enemyDPSHealth'] = dataService.calculateNearDPSHealth(data, unit['enemyUnits']);
    });
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
  setSelfDPSHealthPower: (data, units) => {
    units.forEach(unit => {
      unit['selfUnits'] = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['selfDPSHealth'] = dataService.calculateNearDPSHealth(data, unit['selfUnits']);
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
