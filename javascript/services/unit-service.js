//@ts-check
"use strict"

const Buff = require("@node-sc2/core/constants/buff");
const { HARVEST_GATHER, MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance, WeaponTargetType } = require("@node-sc2/core/constants/enums");
const { ZEALOT, ZERGLING, ROACH } = require("@node-sc2/core/constants/unit-type");
const { add } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("./actions-service");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { CHRONOBOOSTENERGYCOST: CHRONOBOOSTED } = require("@node-sc2/core/constants/buff");
const { filterLabels } = require("../helper/unit-selection");
const { getDistance } = require("./position-service");

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
   * @param {Unit} unit 
   * @returns {boolean}
   */
  canBeChronoBoosted: (unit) => {
    const { buffIds } = unit;
    if (buffIds === undefined) return false;
    return !buffIds.includes(CHRONOBOOSTED) && !unit.isIdle();
  },
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
   * @param {number} buildTime
   * @param {number} progress
   * @returns {number}
   **/
  getBuildTimeLeft(unit, buildTime, progress) {
    const { buffIds } = unit;
    if (buffIds === undefined) return buildTime;
    if (buffIds.includes(CHRONOBOOSTED)) {
      buildTime = buildTime * 2 / 3;
    }
    return Math.round(buildTime * (1 - progress));
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
  getInRangeDestructables: (units, selfUnit) => {
    let tag = null;
    const ROCKS = [373, 638, 639, 640, 643];
    const DEBRIS = [364, 365, 376, 377];
    const destructableRockTypes = [...DEBRIS, ...ROCKS];
    const destructableRockUnits = units.getAlive(Alliance.NEUTRAL).filter(unit => destructableRockTypes.includes(unit.unitType));
    const [closestDestructable] = units.getClosest(selfUnit.pos, destructableRockUnits).filter(destructableRockUnit => getDistance(selfUnit.pos, destructableRockUnit.pos) < 16);
    if (closestDestructable) {
      tag = closestDestructable.tag;
    }
    return tag;
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
   * @param {boolean} adjustForRealSeconds
   * @returns {number | undefined}
   */
  getMovementSpeed: (unit, adjustForRealSeconds=false) => {
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
    return movementSpeed * (adjustForRealSeconds ? 1.4 : 1);
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
   * 
   * @param {UnitResource} units 
   * @param {UnitTypeId[]} mainCombatTypes 
   * @param {UnitTypeId[]} supportUnitTypes 
   * @returns 
   */
  groupUnits: (units, mainCombatTypes, supportUnitTypes) => {
    const combatUnits = [];
    mainCombatTypes.forEach(type => {
      combatUnits.push(...units.getById(type).filter(unit => filterLabels(unit, ['scout', 'harasser'])));
    });
    const supportUnits = [];
    supportUnitTypes.forEach(type => {
      supportUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')));
    });
    return [combatUnits, supportUnits];
  },
  /**
   * @param {Unit} unit
   * @param {boolean} pending
   * @returns {boolean}
   **/
  isConstructing: (unit, pending = false) => {
    /** @type {SC2APIProtocol.UnitOrder[]} */
    let pendingOrders = [];
    if (pending) {
      pendingOrders = unitService.getPendingOrders(unit);
    }
    return unit.isConstructing() || pendingOrders.some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
  },
  /**
   * @param {Unit} unit
   * @param {boolean} pending
   * @returns {boolean}
   */
  isMoving: (unit, pending=false) => {
    const { orders } = unit; if (orders === undefined || orders.length === 0) return false;
    if (pending) {
      /** @type {SC2APIProtocol.UnitOrder[]} */
      const pendingOrders = unitService.getPendingOrders(unit);
      orders.concat(pendingOrders);
    }
    return orders.some(order => order.abilityId === MOVE);
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
    unitService.setPendingOrders(worker, unitCommand);
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
  /**
  * @param {Unit} unit 
  * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand
  * @returns {void}
  */
  setPendingOrders: (unit, unitCommand) => {
    if (unit['pendingOrders']) {
      unit['pendingOrders'].push(unitCommand);
    } else {
      unit['pendingOrders'] = [unitCommand];
    }
  },
  /**
   * @param {Unit[]} units 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  stop: (units) => {
    const collectedActions = [];
    collectedActions.push(createUnitCommand(STOP, units));
    return collectedActions;
  },
  /**
   * @param {Unit} unit
   * @param {Unit} target
   * @param {string} operator
   * @param {number} range
   * @param {AbilityId} abilityId
   * @param {string} pointType
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  triggerAbilityByDistance: (unit, target, operator, range, abilityId, pointType='') => {
    const collectedActions = [];
    if (!unit.isEnemy()) {
      const unitCommand = {};
      if (operator === '>' && getDistance(unit.pos, target) > range) {
        unitCommand.abilityId = abilityId;
        unitCommand.unitTags = [unit.tag];
      } else if (operator === '<' && getDistance(unit.pos, target) < range) {
        unitCommand.abilityId = abilityId;
        unitCommand.unitTags = [unit.tag];
      }
      if (pointType === 'target') {
        unitCommand.targetWorldSpacePos = target;
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  },
}

module.exports = unitService;