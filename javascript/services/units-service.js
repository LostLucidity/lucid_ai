//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");

const unitsService = {
  /**
   * @type number
   */
  selfArmorUpgradeLevel: 0,
  /**
   * @type number
   */
  enemyArmorUpgradeLevel: 0,
  /**
   * @param {Unit[]} units 
   * @returns 
   */
  getArmorUpgradeLevel: (units) => {
    const alliance = units[0] ? units[0].alliance : 0;
    let armorUpgradeLevel = 0;
    if (alliance === Alliance.SELF) {
      armorUpgradeLevel = unitsService.selfArmorUpgradeLevel;
    } else if (alliance === Alliance.ENEMY) {
      armorUpgradeLevel = unitsService.enemyArmorUpgradeLevel;
    }
    return armorUpgradeLevel;
  },
  /**
   * @param {Unit[]} units 
   * @returns {void}
   */
  setArmorUpgradeLevel: (units) => {
    units.some(unit => {
      if (unit.alliance === Alliance.SELF) {
        if (unit.armorUpgradeLevel > unitsService.selfArmorUpgradeLevel) {
          unitsService.selfArmorUpgradeLevel = unit.armorUpgradeLevel;
          return true;
        }
      } else if (unit.alliance === Alliance.ENEMY) {
        if (unit.armorUpgradeLevel > unitsService.enemyArmorUpgradeLevel) {
          unitsService.enemyArmorUpgradeLevel = unit.armorUpgradeLevel;
          return true;
        }
      }
    });
  },
}

module.exports = unitsService;