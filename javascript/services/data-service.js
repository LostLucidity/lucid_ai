//@ts-check
"use strict"

const planService = require("./plan-service");

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
}

module.exports = dataService
