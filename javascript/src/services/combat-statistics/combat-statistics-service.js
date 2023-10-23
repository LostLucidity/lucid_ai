// combat-statistics-service.js

// eslint-disable-next-line no-unused-vars
const { Alliance } = require("@node-sc2/core/constants/enums");
const unitResourceService = require("../../../systems/unit-resource/unit-resource-service");
const { UnitType, Buff } = require("@node-sc2/core/constants");
const { isInMineralLine } = require("../../../systems/map-resource-system/map-resource-service");
const resourceManagerService = require("../../../services/resource-manager-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../../../systems/track-units/track-units-service");
const { getWeaponDPS } = require("../shared-utilities/combat-utilities");
const { isByItselfAndNotAttacking } = require("../unit-analysis");


/**
 * @param {World} world 
 * @param {Unit[]} units 
 * @returns 
 */
function calculateHealthAdjustedSupply(world, units) {
  const { data, resources } = world;
  return units.reduce((accumulator, currentValue) => {
    const halfFood = data.getUnitTypeData(currentValue.unitType).foodRequired / 2;
    return accumulator + (halfFood) + (halfFood * calculateTotalHealthRatio(resources.get().units, currentValue));
  }, 0);
}

/**
 * Calculate DPS health base on ally units and enemy armor upgrades.
 * @param {World} world 
 * @param {Unit[]} units
 * @param {UnitTypeId[]} enemyUnitTypes 
 * @returns {number}
 */
function calculateNearDPSHealth(world, units, enemyUnitTypes) {
  // If there are no enemy units, there's no DPS to calculate
  if (enemyUnitTypes.length === 0) {
    return 0;
  }

  const { resources } = world;
  const { map, units: unitResource } = resources.get();
  return units.reduce((accumulator, unit) => {
    const { pos } = unit; if (pos === undefined) return accumulator;
    if (unit.isWorker()) {
      if (unit.alliance === Alliance.SELF) {
        if (unit.isHarvesting() && !unit.labels.has('retreating') && !unit.labels.has('defending')) {
          return accumulator;
        }
      } else if (unit.alliance === Alliance.ENEMY) {
        if (isByItselfAndNotAttacking(unitResource, unit, enemyTrackingService.mappedEnemyUnits) || isInMineralLine(map, pos)) {
          return accumulator;
        }
      }
    }
    return accumulator + getDPSHealth(world, unit, enemyUnitTypes);
  }, 0);
}

/**
 * @param {World} world
 * @param {Unit[]} selfUnits
 * @param {Unit[]} enemyUnits
 * @returns {{timeToKill: number, timeToBeKilled: number}}
 */
function calculateTimeToKillUnits(world, selfUnits, enemyUnits) {
  if (selfUnits.length === 0) {
    return { timeToKill: Infinity, timeToBeKilled: 0 };
  }

  if (enemyUnits.length === 0) {
    return { timeToKill: 0, timeToBeKilled: Infinity };
  }

  const timeToKill = enemyUnits.reduce((timeToKill, threat) => {
    const { health, shield, unitType } = threat; if (health === undefined || shield === undefined || unitType === undefined) return timeToKill;
    const totalHealth = health + shield;
    const totalWeaponDPS = selfUnits.reduce((totalWeaponDPS, unit) => {
      const { unitType } = unit; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.SELF, enemyUnits.map(threat => threat.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToKillCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToKill === Infinity) ? timeToKillCurrent : timeToKill + timeToKillCurrent;
  }, Infinity);
  const timeToBeKilled = selfUnits.reduce((timeToBeKilled, unit) => {
    const { health, shield, unitType } = unit; if (health === undefined || shield === undefined || unitType === undefined) return timeToBeKilled;
    const totalHealth = health + shield;
    const totalWeaponDPS = enemyUnits.reduce((totalWeaponDPS, threat) => {
      const { unitType } = threat; if (unitType === undefined) return totalWeaponDPS;
      const weaponDPS = getWeaponDPS(world, unitType, Alliance.ENEMY, selfUnits.map(unit => unit.unitType));
      return totalWeaponDPS + weaponDPS;
    }, 0);
    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);
  return { timeToKill, timeToBeKilled };
}

/**
 * Calculates the total health ratio of a unit.
 * @param {UnitResource} units 
 * @param {Unit} unit 
 * @returns {number}
 */
function calculateTotalHealthRatio(units, unit) {
  if (unitResourceService.getUnitTypeData(units, unit.unitType)) {
    const { healthMax, shieldMax } = unitResourceService.getUnitTypeData(units, unit.unitType);
    const totalHealthShield = unit.health + unit.shield;
    const maxHealthShield = healthMax + shieldMax;
    return maxHealthShield > 0 ? totalHealthShield / maxHealthShield : 0;
  }
  return 0;
}

/**
 * @param {World} world 
 * @param {Unit} unit
 * @param {UnitTypeId[]} enemyUnitTypes 
 * @returns {number}
 */
function getDPSHealth(world, unit, enemyUnitTypes) {
  const { resources } = world;
  const { units } = resources.get();
  const { getUnitTypeData } = unitResourceService;
  const { ADEPT, ADEPTPHASESHIFT } = UnitType;
  let dPSHealth = 0;
  // if unit.unitType is an ADEPTPHASESHIFT, use values of ADEPT assigned to it
  let { alliance, buffIds, health, buildProgress, shield, unitType } = unit;
  if (alliance === undefined || buffIds === undefined || health === undefined || buildProgress === undefined || shield === undefined || unitType === undefined) return 0;
  unitType = unitType !== ADEPTPHASESHIFT ? unitType : ADEPT;
  unit = getUnitForDPSCalculation(resources, unit);
  let healthAndShield = 0;
  if (unit && buildProgress >= 1) {
    healthAndShield = health + shield;
  } else {
    const unitTypeData = getUnitTypeData(units, unitType);
    if (unitTypeData) {
      const { healthMax, shieldMax } = unitTypeData;
      healthAndShield = healthMax + shieldMax;
    }
  }
  if (buildProgress > 0.90) {
    dPSHealth = getWeaponDPS(world, unitType, alliance, enemyUnitTypes) * healthAndShield * (buffIds.includes(Buff.STIMPACK) ? 1.5 : 1);
  }
  return dPSHealth;
}

module.exports = {
  calculateHealthAdjustedSupply,
  calculateNearDPSHealth,
  calculateTimeToKillUnits,
  calculateTotalHealthRatio,
  getDPSHealth,
};

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit 
 * @returns {Unit}
 */
function getUnitForDPSCalculation(resources, unit) {
  const { units } = resources.get();
  const pathFindingService = resourceManagerService;
  const { ADEPT, ADEPTPHASESHIFT } = UnitType;
  if (unit.unitType === ADEPTPHASESHIFT) {
    const label = 'ADEPT';
    if (unit.hasLabel(label)) {
      unit = getByTag(unit.getLabel(label));
    } else {
      // find the closest ADEPT that has not been assigned to unit
      const [closestAdept] = getUnitsByAllianceAndType(unit.alliance, ADEPT).filter(adept => {
        // return true if adept.tag does not exist in units.withLabel('ADEPT');
        return !units.withLabel(label).some(unit => unit.labels.get(label) === adept.tag);
      }).sort((a, b) => pathFindingService.getDistanceByPath(resources, a.pos, unit.pos) - pathFindingService.getDistanceByPath(resources, b.pos, unit.pos));
      if (closestAdept) {
        unit.labels.set(label, closestAdept.tag);
        console.log(`${unit.unitType} ${unit.tag} assigned to ${closestAdept.unitType} ${closestAdept.tag}`);
      }
      return closestAdept;
    }
  }
  return unit;
}

/**
 * @param {string} tag 
 * @returns {Unit}
 */
function getByTag(tag) {
  return enemyTrackingService.mappedEnemyUnits.find(unit => unit.tag === tag);
}

/**
 * 
 * @param {SC2APIProtocol.Alliance} alliance
 * @param {UnitTypeId} unitType 
 * @returns {Unit[]}
 */
function getUnitsByAllianceAndType(alliance, unitType) {
  if (alliance === Alliance.SELF) {
    return trackUnitsService.selfUnits.filter(unit => unit.unitType === unitType);
  } else if (alliance === Alliance.ENEMY) {
    return enemyTrackingService.mappedEnemyUnits.filter(unit => unit.unitType === unitType);
  } else {
    return [];
  }
}