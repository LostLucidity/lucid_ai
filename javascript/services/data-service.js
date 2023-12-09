//@ts-check
"use strict"

const { UnitType, WarpUnitAbility, Upgrade } = require("@node-sc2/core/constants");
const { EFFECT_CHRONOBOOSTENERGYCOST } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const curatedAbilities = require("../constants/curated-abilities");
const { requiresPylon } = require("./agent-service");
const unitService = require("./unit-service");

const dataService = {
  /** @type number[] */
  allActions: [],
  curatedAbilityMapping: [],
  /** @type {Map<string, number>} */
  foodEarmarks: new Map(),
  /** @type {Map<number, number>} */
  upgradeAbilities: [],
  /**
   * 
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   */
  calculateNearSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  },
  /**
   * @param {DataStorage} data
   * @returns {void}
   */
  clearEarmarks(data) {
    data.get('earmarks').forEach((/** @type {Earmark} */ earmark) => data.settleEarmark(earmark.name));
    dataService.foodEarmarks.clear();
    dataService.earmarks = [];
  },
  /**
   * @returns {number[]}
   */
  getAllActions: () => {
    let { allActions, curatedAbilityMapping, unitTypeTrainingAbilities, upgradeAbilities } = dataService;
    if (allActions.length === 0) {
      allActions = Array.from(unitTypeTrainingAbilities.keys()).concat(Object.keys(upgradeAbilities).map(key => parseInt(key))).concat(curatedAbilityMapping);
      dataService.allActions = allActions;
    }
    return allActions;
  },
  /**
   * Returns the effective attack range of the given unit considering the unit's and target's radii.
   *
   * @param {DataStorage} data - The game data storage object.
   * @param {Unit} unit - The unit for which to get the attack range.
   * @param {Unit} targetType - The type of unit that is being targeted.
   * @returns {number} - The effective attack range. If data is not available, returns 0.
   * @description If the unit data or weapons data is not available, an attack range of 0 is assumed.
   * Otherwise, the range of the weapon that can attack the targetType plus unit's and target's radii is returned.
   */
  getAttackRange: (data, unit, targetType) => {
    const { unitType, radius: unitRadius = 0 } = unit;
    const { radius: targetRadius = 0 } = targetType;

    if (typeof unitType === 'undefined') {
      return 0;
    }

    const weapon = unitService.getWeaponThatCanAttack(data, unitType, targetType);

    if (!weapon) {
      return 0;
    }

    const { range: weaponRange = 0 } = weapon;

    return weaponRange + unitRadius + targetRadius;
  },
  /**
   * @param {DataStorage} data
   * @param {SC2APIProtocol.Weapon} weapon 
   * @param {UnitTypeId[]} enemyUnitTypes
   * @returns number
   */
  getAttributeBonusDamageAverage: (data, weapon, enemyUnitTypes) => {
    const totalBonusDamage = enemyUnitTypes.reduce((previousValue, unitType) => {
      let damage = 0;
      weapon.damageBonus.forEach(bonus => {
        if (data.getUnitTypeData(unitType).attributes.find(attribute => attribute === bonus.attribute)) {
          damage += bonus.bonus;
        }
      });
      return previousValue + damage;
    }, 0);
    return totalBonusDamage > 0 ? (totalBonusDamage / enemyUnitTypes.length) : 0;
  },
  /**
   * @param {World} world 
   * @returns {Map<number, import("../interfaces/actions-map").ActionsMap>}
   */
  getAllAvailableAbilities(world) {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    /** @type {Map<number, any>} */
    const allAvailableAbilities = new Map();

    const { upgradeAbilities } = dataService;
    const unitTypeTrainingAbilitiesKeys = new Set(dataService.unitTypeTrainingAbilities.keys());
    const upgradeAbilitiesKeys = new Set(Object.keys(upgradeAbilities).map(Number));

    units.getAlive(Alliance.SELF).forEach(unit => {
      const { unitType } = unit;
      if (unitType === undefined) return;
      if (!unit.isStructure() || unit.isIdle() || (unit.hasReactor() && unit.orders.length === 1)) {
        unit.availableAbilities().forEach(ability => {
          if (!allAvailableAbilities.has(ability)) {
            if (unitTypeTrainingAbilitiesKeys.has(ability)) {
              const unitTypeData = data.getUnitTypeData(dataService.unitTypeTrainingAbilities.get(ability));
              if (unitTypeData.unitAlias === 0) {
                if (requiresPylon(agent, unitTypeData) && units.getById(UnitType.PYLON).length === 0) {
                  return;
                }
                allAvailableAbilities.set(ability, { orderType: 'UnitType', unitType: dataService.unitTypeTrainingAbilities.get(ability) });
              }
            } else if (upgradeAbilitiesKeys.has(ability)) {
              allAvailableAbilities.set(ability, { orderType: 'Upgrade', upgrade: upgradeAbilities[ability] });
            } else if (ability === EFFECT_CHRONOBOOSTENERGYCOST) {
              allAvailableAbilities.set(ability, { orderType: 'Ability' });
            }
          }
        });
      }
    });

    allAvailableAbilities.set(0, { orderType: 'NoOp' });
    return allAvailableAbilities;
  },
  /**
   * @param {DataStorage} data
   * @param {Unit} unit
   * @returns {number}
   */
  getBuildTimeElapsed(data, unit) {
    const { buildProgress } = unit;
    const { buildTime } = data.getUnitTypeData(unit.unitType);
    return getTimeInSeconds(buildTime) * buildProgress;
  },
  /**
   * @param {DataStorage} data 
   * @param {Point2D} position
   * @param {Unit} unit 
   * @param {Unit[]} targetUnits 
   * @returns {number}
   */
  getUnitWeaponDistanceToPosition(data, position, unit, targetUnits) {
    const { radius, unitType } = unit; if (radius === undefined || unitType === undefined) return Infinity;
    return targetUnits.reduce((/** @type {number} */ acc, targetUnit) => {
      const { pos, radius: targetRadius } = targetUnit; if (pos === undefined || targetRadius === undefined) return acc;
      const weapon = unitService.getWeaponThatCanAttack(data, unitType, targetUnit); if (weapon === undefined) return acc;
      const { range } = weapon; if (range === undefined) return acc;
      const distanceToEnemyUnit = getDistance(position, pos) - range - radius - targetRadius;
      return Math.min(acc, distanceToEnemyUnit);
    }, Infinity);
  },
  /**
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   * @returns {number}
   */
  getSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  },
  
  /**
   * @param {DataStorage} data
   * @returns {boolean}
   */
  hasEarmarks: (data) => {
    const earmarkTotals = data.getEarmarkTotals('');
    return earmarkTotals.minerals > 0 || earmarkTotals.vespene > 0;
  },
  /**
   * @param {DataStorage} data
   * @param {Unit} unit 
   */
  isTrainingUnit: (data, unit) => {
    return unit.orders.some(order => {
      return Object.keys(UnitType).some(key => order.abilityId === data.getUnitTypeData(UnitType[key]).abilityId);
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
  setSelfSupplyPowers: (data, units) => {
    units.forEach(unit => {
      unit['selfUnits'] = units.filter(toFilterUnit => distance(unit.pos, toFilterUnit.pos) <= 16);
      unit['selfSupply'] = dataService.calculateNearSupply(data, unit['selfUnits']);
    });
  },
  /**
   * @param {DataStorage} data 
   */
  setCuratedAbilityMapping: (data) => {
    const { curatedAbilityMapping } = dataService;
    Array.from(Object.values(curatedAbilities)).forEach(ability => {
      const { abilityId } = data.getAbilityData(ability); if (abilityId === undefined) return;
      curatedAbilityMapping[abilityId.toString()] = ability;
    });
    dataService.curatedAbilityMapping = curatedAbilityMapping;
  },
  /**
   * @param {DataStorage} data 
   */
  setGameData: (data) => {
    const { setUnitTypeTrainingAbilityMapping, setUpgradeAbilities, setCuratedAbilityMapping } = dataService;
    setUnitTypeTrainingAbilityMapping(data);
    setUpgradeAbilities(data);
    setCuratedAbilityMapping(data);
  },
  /**
   * @param {DataStorage} data 
   */
  setUnitTypeTrainingAbilityMapping: (data) => {
    Array.from(Object.values(UnitType)).forEach(unitTypeId => {
      dataService.unitTypeTrainingAbilities.set(data.getUnitTypeData(unitTypeId).abilityId, unitTypeId);
      WarpUnitAbility[unitTypeId] && (dataService.unitTypeTrainingAbilities.set(WarpUnitAbility[unitTypeId], unitTypeId));
    });
  },
  /**
   * @param {DataStorage} data 
   */
  setUpgradeAbilities: (data) => {
    const { upgradeAbilities } = dataService;
    Array.from(Object.values(Upgrade)).forEach(upgrade => {
      const { abilityId } = data.getUpgradeData(upgrade); if (abilityId === undefined) return;
      upgradeAbilities[abilityId.toString()] = upgrade;
    });
    dataService.upgradeAbilities = upgradeAbilities;
  }
}

module.exports = dataService

