//@ts-check
"use strict"

const { HARVEST_GATHER, STOP } = require("@node-sc2/core/constants/ability");
const { Alliance, WeaponTargetType } = require("@node-sc2/core/constants/enums");
const { add } = require("@node-sc2/core/utils/geometry/point");
const { CHRONOBOOSTENERGYCOST: CHRONOBOOSTED } = require("@node-sc2/core/constants/buff");
const { filterLabels } = require("../helper/unit-selection");
const { UnitType } = require("@node-sc2/core/constants");

const unitService = {
  /** @type Map<UnitTypeId, number> */
  ZERG_UNITS_ON_CREEP_BONUS: new Map([
    [UnitType.QUEEN, 2.67],
    [UnitType.LOCUSTMP, 1.4],
    [UnitType.SPORECRAWLER, 1.5],
    [UnitType.SPINECRAWLER, 1.5],
  ]),
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
