//@ts-check
"use strict"

const { HARVEST_GATHER } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { ZEALOT } = require("@node-sc2/core/constants/unit-type");
const { createUnitCommand } = require("./actions-service");

const unitService = {
  /**
   * @type boolean
   */
  enemyCharge: false,
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
      armorUpgradeLevel = unitService.selfArmorUpgradeLevel;
    } else if (alliance === Alliance.ENEMY) {
      armorUpgradeLevel = unitService.enemyArmorUpgradeLevel;
    }
    return armorUpgradeLevel;
  },
  /**
   * @param {Alliance} alliance 
   */
  getAttackUpgradeLevel: (alliance) => {
    let attackUpgradeLevel = 0;
    if (alliance === Alliance.SELF) {
      attackUpgradeLevel = unitService.selfAttackUpgradeLevel;
    } else if (alliance === Alliance.ENEMY) {
      attackUpgradeLevel = unitService.enemyAttackUpgradeLevel;
    }
    return attackUpgradeLevel;
  },
  /**
   * @param {Unit} unit 
   */
  getEnemyMovementSpeed: (unit) => {
    let { movementSpeed } = unit.data();
    if (unit.unitType === ZEALOT && unitService.enemyCharge) {
      movementSpeed = 4.72 / 1.4;
    }
    return movementSpeed;
  },
  /**
   * @param {Unit} worker 
   * @param {Unit} target 
   * @param {boolean} queue 
   * @returns {SC2APIProtocol.ActionRawUnitCommand}
   */
  mine: (worker, target, queue = true) => {
    const unitCommand = createUnitCommand(HARVEST_GATHER, [worker], queue);
    unitCommand.targetUnitTag = target.tag;
    return unitCommand;
  },
  /**
   * @param {Unit[]} units 
   * @returns {void}
   */
  setAttackUpgradeLevel: (units) => {
    units.some(unit => {
      if (unit.alliance === Alliance.SELF) {
        if (unit.armorUpgradeLevel > unitService.selfArmorUpgradeLevel) {
          unitService.selfArmorUpgradeLevel = unit.armorUpgradeLevel;
          return true;
        }
      } else if (unit.alliance === Alliance.ENEMY) {
        if (unit.armorUpgradeLevel > unitService.enemyArmorUpgradeLevel) {
          unitService.enemyArmorUpgradeLevel = unit.armorUpgradeLevel;
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
        if (unit.armorUpgradeLevel > unitService.selfArmorUpgradeLevel) {
          unitService.selfArmorUpgradeLevel = unit.armorUpgradeLevel;
          return true;
        }
      } else if (unit.alliance === Alliance.ENEMY) {
        if (unit.armorUpgradeLevel > unitService.enemyArmorUpgradeLevel) {
          unitService.enemyArmorUpgradeLevel = unit.armorUpgradeLevel;
          return true;
        }
      }
    });
  },
}

module.exports = unitService;