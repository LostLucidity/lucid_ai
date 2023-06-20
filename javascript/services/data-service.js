//@ts-check
"use strict"

const { Ability, UnitType, WarpUnitAbility, Upgrade } = require("@node-sc2/core/constants");
const { EFFECT_CHRONOBOOSTENERGYCOST } = require("@node-sc2/core/constants/ability");
const { Alliance, Race, Attribute } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const curatedAbilities = require("../constants/curated-abilities");
const { getTimeInSeconds } = require("./frames-service");
const { getDistance } = require("./position-service");
const { getWeaponThatCanAttack } = require("./unit-service");

const dataService = {
  /** @type number[] */
  allActions: [],
  curatedAbilityMapping: [],
  /** @type {Earmark[]} */
  earmarks: [],
  /** @type {Map<string, number>} */
  foodEarmarks: new Map(),
  /** @type {Map<number, number>} */
  unitTypeTrainingAbilities: new Map(),
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
   * @param {DataStorage} data 
   * @returns {boolean}
   */
  earmarkThresholdReached: (data) => {
    const { minerals: earmarkedTotalMinerals, vespene: earmarkedTotalVespene } = data.getEarmarkTotals('');
    return earmarkedTotalMinerals > 512 && earmarkedTotalVespene > 512 || earmarkedTotalMinerals > 1024;
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
 * @param {UnitResource} units 
 * @returns {Map<number, import("../interfaces/actions-map").ActionsMap>}
 */
  getAllAvailableAbilities(world, units) {
    const { agent, data } = world;
    /** @type {Map<number, any>} */
    const allAvailableAbilities = new Map();
    const { upgradeAbilities } = dataService;
    units.getAlive(Alliance.SELF).forEach(unit => {
      const { unitType } = unit; if (unitType === undefined) return;
      if (!unit.isStructure() || unit.isIdle() || unit.hasReactor() && unit.orders.length === 1) {
        const availableAbilities = unit.availableAbilities();
        availableAbilities.forEach(ability => {
          if (!allAvailableAbilities.has(ability)) {
            const unitTypeTrainingAbilities = dataService.unitTypeTrainingAbilities;
            if (Array.from(unitTypeTrainingAbilities.keys()).some(unitTypeAbility => unitTypeAbility === ability)) {
              const unitTypeData = data.getUnitTypeData(unitTypeTrainingAbilities.get(ability));
              if (unitTypeData.unitAlias === 0) {
                if (requiresPylon(agent, unitTypeData) && units.getById(UnitType.PYLON).length === 0) {
                  return; // Skip this unit if it's a Protoss structure that requires a Pylon and there's no Pylon
                }
                allAvailableAbilities.set(ability, { orderType: 'UnitType', unitType: unitTypeTrainingAbilities.get(ability) });
              } else {
                // ignore
              }
            } else if (Object.keys(upgradeAbilities).some(upgradeAbility => parseInt(upgradeAbility) === ability)) {
              allAvailableAbilities.set(ability, { orderType: 'Upgrade', upgrade: upgradeAbilities[ability] });
            } else if ([EFFECT_CHRONOBOOSTENERGYCOST].includes(ability)) {
              allAvailableAbilities.set(ability, { orderType: 'Ability' });
            }
          }
        })
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
   * @description Get total food earmarked for all steps
   * @returns {number}
   */
  getEarmarkedFood: () => {
    return Array.from(dataService.foodEarmarks.values()).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
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
      const weapon = getWeaponThatCanAttack(data, unitType, targetUnit); if (weapon === undefined) return acc;
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
   * @param {Alliance} alliance
   * @param {number} damage 
   * @returns {number}
   */
  getUpgradeBonus: (alliance, damage) => {
    if (alliance === Alliance.SELF) {
      return 0;
    } else if (alliance === Alliance.ENEMY) {
      // divide damage by 10, round, min 1.
      const roundedDamage = Math.round(damage / 10);
      return roundedDamage > 0 ? roundedDamage : 1;
    }
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

/**
 * @param {Agent} agent
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 * @returns {boolean}
 */
function requiresPylon(agent, unitTypeData) {
  // return false immediately if agent race is not protoss
  if (agent.race !== Race.PROTOSS) return false;

  // Nexus, assimilator, pylon do not require pylon
  const { attributes, unitId } = unitTypeData;
  if (attributes === undefined || unitId === undefined) return false;

  const isStructure = attributes.includes(Attribute.STRUCTURE);
  const requiresPylon = [UnitType.NEXUS, UnitType.ASSIMILATOR, UnitType.PYLON].every(unitType => unitId !== unitType);

  return isStructure && requiresPylon;
}

