//@ts-check
"use strict"

const { UnitType, WarpUnitAbility, Upgrade } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getTimeInSeconds } = require("./frames-service");
const planService = require("./plan-service");
const { getDistance } = require("./position-service");
const { getWeaponThatCanAttack } = require("./unit-service");

const dataService = {
  /** @type number[] */
  allActions: [],
  earmarks: [],
  /** @type {Map<number, number>} */
  unitTypeTrainingAbilities: new Map(),
  /** @type {Map<number, number>} */
  upgradeAbilities: [],
  /**
   * 
   * @param {World['data']} data 
   * @param {SC2APIProtocol.UnitTypeData|SC2APIProtocol.UpgradeData} orderData 
   */
  addEarmark: (data, orderData) => {
    const { name, mineralCost, vespeneCost } = orderData; if (name === undefined || mineralCost === undefined || vespeneCost === undefined) return;
    const earmark = {
      name: `${name}_${planService.currentStep}`,
      minerals: mineralCost,
      vespene: vespeneCost,
    }
    data.addEarmark(earmark);
    dataService.earmarks.push(earmark);
  },
  /**
   * 
   * @param {DataStorage} data 
   * @param {Unit[]} units 
   */
  calculateNearSupply: (data, units) => {
    return units.reduce((accumulator, currentValue) => accumulator + data.getUnitTypeData(currentValue.unitType).foodRequired, 0);
  }, 
  /**
   * @returns {number[]}
   */
  getAllActions: () => {
    let { allActions, unitTypeTrainingAbilities, upgradeAbilities } = dataService;
    if (allActions.length === 0) {
      allActions = Array.from(unitTypeTrainingAbilities.keys()).concat(Object.keys(upgradeAbilities).map(key => parseInt(key)));
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
   * @param {DataStorage} data 
   * @param {UnitResource} units 
   * @returns {Map<number, { "orderType": string, "unitType"?: number, "upgrade"?: number }>}
   */
  getAllAvailableAbilities(data, units) {
    /** @type {Map<number, any>} */
    const allAvailableAbilities = new Map();
    const { upgradeAbilities } = dataService;
    units.getAlive(Alliance.SELF).forEach(unit => {
      if (!unit.isStructure() || unit.isIdle() || unit.hasReactor() && unit.orders.length === 1) {
        const availableAbilities = unit.availableAbilities();
        availableAbilities.forEach(ability => {
          if (!allAvailableAbilities.has(ability)) {
            const unitTypeTrainingAbilities = dataService.unitTypeTrainingAbilities;
            unitTypeTrainingAbilities.entries()
            if (Array.from(unitTypeTrainingAbilities.keys()).some(unitTypeAbility => unitTypeAbility === ability)) {
              const unitTypeData = data.getUnitTypeData(unitTypeTrainingAbilities.get(ability));
              if (unitTypeData.unitAlias === 0) {
                allAvailableAbilities.set(ability, { orderType: 'UnitType', unitType: unitTypeTrainingAbilities.get(ability) });
              } else {
                // ignore
              }
            } else if (Object.keys(upgradeAbilities).some(upgradeAbility => parseInt(upgradeAbility) === ability)) {
              allAvailableAbilities.set(ability, { orderType: 'Upgrade', upgrade: upgradeAbilities[ability] });
            }
          }
        })
      }
    });
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