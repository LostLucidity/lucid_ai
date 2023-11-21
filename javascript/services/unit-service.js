//@ts-check
"use strict"

const Buff = require("@node-sc2/core/constants/buff");
const { HARVEST_GATHER, MOVE, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance, WeaponTargetType } = require("@node-sc2/core/constants/enums");
const { add } = require("@node-sc2/core/utils/geometry/point");
const { constructionAbilities } = require("@node-sc2/core/constants/groups");
const { CHRONOBOOSTENERGYCOST: CHRONOBOOSTED } = require("@node-sc2/core/constants/buff");
const { filterLabels } = require("../helper/unit-selection");
const { UnitType } = require("@node-sc2/core/constants");

/** @type {(unit: Unit) => number} */
const zealotModifier = unit => (unit.alliance === Alliance.ENEMY && unitService.enemyCharge) ? 0.5 : 0;

/** @type {(unit: Unit) => number} */
const zerglingModifier = unit => (unit.alliance === Alliance.ENEMY && unitService.enemyMetabolicBoost) ? (4.69921875 / 2.9351) - 1 : 0;

const unitService = {
  /** @type Map<UnitTypeId, (unit: Unit) => number> */
  SPEED_MODIFIERS: new Map([
    [UnitType.ZEALOT, zealotModifier],
    [UnitType.ZERGLING, zerglingModifier],
  ]),
  /** @type Map<UnitTypeId, number> */
  ZERG_UNITS_ON_CREEP_BONUS: new Map([
    [UnitType.QUEEN, 2.67],
    [UnitType.LOCUSTMP, 1.4],
    [UnitType.SPORECRAWLER, 1.5],
    [UnitType.SPINECRAWLER, 1.5],
  ]),
  /**
   * @type boolean
   */
  enemyCharge: false,
  /**
   * @type boolean
   */
  enemyMetabolicBoost: false,
  /** @type number */
  liftAndLandingTime: 64 / 22.4,
  /**
   * @type boolean
   */
  selfGlialReconstitution: false,
  /**
   * @type number
   */
  selfArmorUpgradeLevel: 0,
  /** @type Map<string, number> */
  selfDPSHealth: new Map(),
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
  /** @type Map<number, number> */
  movementSpeedByType: new Map(),
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
   * Retrieves the armor upgrade level based on the alliance of the unit.
   * 
   * @param {Alliance} alliance - The alliance of the unit (SELF, NEUTRAL, ENEMY).
   * @returns {number} - The armor upgrade level of the unit.
   */
  getArmorUpgradeLevel: (alliance) => {
    if (alliance === Alliance.ENEMY) {
      return unitService.enemyArmorUpgradeLevel;
    }

    // Default to 0 if the alliance is not ENEMY.
    return 0;
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
  /**
   * 
   * @param {UnitResource} units
   * @param {Unit} selfUnit
   * @returns {string | null | undefined}
   */
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
   * Helper function to get units within a given radius around a position.
   * @param {Unit[]} units - The list of units to search from.
   * @param {Point2D | SC2APIProtocol.Point} pos - The center position.
   * @param {number} radius - The search radius.
   * @returns {Unit[]} - Units within the given radius.
   */
  getUnitsInRadius: (units, pos, radius) => {
    return units.filter(unit => {
      if (!unit.pos) return false;  // Skip units without a position
      const distance = getDistance(pos, unit.pos);
      return distance <= radius;
    });
  },
  /**
   * @param {MapResource} map
   * @param {Unit} unit 
   * @param {boolean} adjustForRealSeconds
   * @returns {number}
   */
  getMovementSpeed: function (map, unit, adjustForRealSeconds = false) {
    const { pos, unitType } = unit;
    if (!pos || !unitType) return 0;

    let movementSpeed = unitService.getMovementSpeedByType(unit);
    if (!movementSpeed) return 0;

    const { SPEED_MODIFIERS, ZERG_UNITS_ON_CREEP_BONUS } = unitService;

    // Apply speed modifier specific to the unit type, if any.
    const speedModifierFunc = SPEED_MODIFIERS.get(unitType);
    if (speedModifierFunc) {
      movementSpeed += speedModifierFunc(unit);
    }

    let multiplier = adjustForRealSeconds ? 1.4 : 1;

    // Apply stimpack buff speed multiplier.
    if (unit.buffIds?.includes(Buff.STIMPACK)) {
      multiplier *= 1.5;
    }

    // Apply speed bonus for Zerg units on creep.
    if (map.hasCreep(pos)) {
      multiplier *= ZERG_UNITS_ON_CREEP_BONUS.get(unitType) || 1.3;
    }

    return movementSpeed * multiplier;
  },
  /**
   * @param {Unit} unit
   * @returns {number | undefined}
   */
  getMovementSpeedByType: (unit) => {
    const { unitType } = unit; if (unitType === undefined) return;
    if (!unitService.movementSpeedByType.has(unitType)) {
      const { movementSpeed } = unit.data(); if (movementSpeed === undefined) return;
      unitService.movementSpeedByType.set(unitType, movementSpeed);
    }
    return unitService.movementSpeedByType.get(unitType);
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

    // Find weapon that can attack target.
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
    const combatUnits = mainCombatTypes.flatMap(type =>
      units.getById(type).filter(unit => filterLabels(unit, ['scout', 'harasser']))
    );

    const supportUnits = supportUnitTypes.flatMap(type =>
      units.getById(type).filter(unit => !unit.labels.get('scout'))
    );

    return [combatUnits, supportUnits];
  }
,
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
   * Determines if a unit is potentially a combatant.
   * @param {Unit} unit - Unit to check.
   * @returns {boolean} - True if unit has potential for combat, otherwise false.
   */
  potentialCombatants: (unit) =>
    unit.isCombatUnit() || unit.unitType === UnitType.QUEEN || (unit.isWorker() && !unit.isHarvesting()),
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
