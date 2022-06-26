//@ts-check
"use strict"

const Ability = require("@node-sc2/core/constants/ability");
const { HARVEST_GATHER } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { liftingAbilities, landingAbilities } = require("@node-sc2/core/constants/groups");
const { ZEALOT, ZERGLING, ROACH } = require("@node-sc2/core/constants/unit-type");
const { distance, add } = require("@node-sc2/core/utils/geometry/point");
const { setPendingOrders } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("./actions-service");
const planService = require("./plan-service");

const unitService = {
  /**
   * @type boolean
   */
  enemyCharge: false,
  /**
   * @type boolean
   */
  enemyMetabolicBoost: false,
  /**
   * @type boolean
   */
  selfGlialReconstitution: false,
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
   * @returns {Point2D}
   */
  getUnitCornerPosition: (unit) => {
    return add(unit.pos, unit.radius);
  },
  /**
   * @param {Unit} unit 
   */
  getMovementSpeed: (unit) => {
    let { movementSpeed } = unit.data();
    if (unit.unitType === ROACH) {
      if (unit.alliance === Alliance.SELF && unitService.selfGlialReconstitution) {
        movementSpeed += 0.75;
      }
    }
    if (unit.unitType === ZEALOT) {
      if (unit.alliance === Alliance.ENEMY && unitService.enemyCharge) {
        movementSpeed = movementSpeed * 1.5
      }
    }
    if (unit.unitType === ZERGLING) {
      if (unit.alliance === Alliance.ENEMY && unitService.enemyMetabolicBoost) {
        movementSpeed = movementSpeed * 1.6
      }
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
   * @param {Unit} unit
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  repositionBuilding: (unit) => {
    const collectedActions = [];
    if (unit.availableAbilities().find(ability => liftingAbilities.includes(ability)) && !unit.labels.has('pendingOrders')) {
      if (distance(unit.pos, unit.labels.get('reposition')) > 1) {
        const unitCommand = createUnitCommand(Ability.LIFT, [unit]);
        collectedActions.push(unitCommand);
        setPendingOrders(unit, unitCommand);
      } else {
        unit.labels.delete('reposition');
      }
    }
    if (unit.availableAbilities().find(ability => landingAbilities.includes(ability))) {
      const unitCommand = createUnitCommand(Ability.LAND, [unit]);
      unitCommand.targetWorldSpacePos = unit.labels.get('reposition');
      collectedActions.push(unitCommand);
      planService.pausePlan = false;
      setPendingOrders(unit, unitCommand);
    } else {
      // Ignore units that can't land
    }
    return collectedActions;
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