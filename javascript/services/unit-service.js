//@ts-check
"use strict"

const Buff = require("@node-sc2/core/constants/buff");
const { HARVEST_GATHER, MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance, WeaponTargetType } = require("@node-sc2/core/constants/enums");
const { ZEALOT, ZERGLING, ROACH } = require("@node-sc2/core/constants/unit-type");
const { add } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("./actions-service");

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
  /** @type Map<string, Unit[]> */
  selfUnits: new Map(),
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
   * @param {WeaponTargetType} weaponTargetType 
   * @returns {SC2APIProtocol.Weapon|undefined}
   */
  getHighestRangeWeapon: (unit, weaponTargetType) => {
    const { weapons } = unit.data();
    const [highestRange] = weapons.filter((weapon) => {
      return weapon.type === weaponTargetType || weapon.type === WeaponTargetType.ANY;
    }).sort((a, b) => {
      return b.range - a.range;
    });
    return highestRange;
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
   * @returns {number | undefined}
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
    if (unit.buffIds.includes(Buff.STIMPACK)) {
      movementSpeed = movementSpeed * 1.5
    }
    return movementSpeed;
  },
  /**
   * @param {Unit} unit
   * @returns {SC2APIProtocol.UnitOrder[]}
   */
  getPendingOrders: (unit) => {
    return unit['pendingOrders'] || [];
  },
  /**
   * Get weapon that can attack target
   * @param {DataStorage} data
   * @param {UnitTypeId} unitTypeId
   * @param {Unit} target
   * @returns {SC2APIProtocol.Weapon | undefined}
   */
  getWeaponThatCanAttack: (data, unitTypeId, target) => {
    const { weapons } = data.getUnitTypeData(unitTypeId);
    // find weapon that can attack target
    if (!weapons) return undefined;
    const weapon = weapons.find(weapon => {
      const { type } = weapon;
      if (type === WeaponTargetType.GROUND && target.isFlying) {
        return false;
      }
      if (type === WeaponTargetType.AIR && !target.isFlying) {
        return false;
      }
      return true;
    });
    return weapon;
  },
  /**
   * @param {Unit} unit
   * @returns {boolean}
   */
  isMoving: (unit) => {
    const { orders } = unit;
    if (orders === undefined || orders.length === 0) return false;
    return orders[0].abilityId === MOVE;
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