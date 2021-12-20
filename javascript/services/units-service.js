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
   * @type number
   */
  selfAttackUpgradeLevel: 0,
  /**
   * @type number
   */
  enemyAttackUpgradeLevel: 0,
  /**
   * @param {Alliance} alliance 
   * @returns 
   */
  getArmorUpgradeLevel: (alliance) => {
    let armorUpgradeLevel = 0;
    if (alliance === Alliance.SELF) {
      armorUpgradeLevel = unitsService.selfArmorUpgradeLevel;
    } else if (alliance === Alliance.ENEMY) {
      armorUpgradeLevel = unitsService.enemyArmorUpgradeLevel;
    }
    return armorUpgradeLevel;
  },
  /**
   * @param {Alliance} alliance 
   */
  getAttackUpgradeLevel: (alliance) => {
    let attackUpgradeLevel = 0;
    if (alliance === Alliance.SELF) {
      attackUpgradeLevel = unitsService.selfAttackUpgradeLevel;
    } else if (alliance === Alliance.ENEMY) {
      attackUpgradeLevel = unitsService.enemyAttackUpgradeLevel;
    }
    return attackUpgradeLevel;
  },
  /**
   * @param {Unit[]} units 
   * @returns {void}
   */
   setAttackUpgradeLevel: (units) => {
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