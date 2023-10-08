//@ts-check
"use strict";

const { createSystem } = require("@node-sc2/core");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const healthTrackingService = require("./health-tracking-service");
const { getWeaponDPS } = require("../../src/services/combat-statistics");

module.exports = createSystem({
  name: "HealthTrackingSystem",
  type: "agent",
  async onGameStart(world) {
    // Store the initial health and shield and initialize 0 difference of all units in the world for each alliance.
    const { units } = world.resources.get();
    units.getAlive().forEach(unit => {
      if ([Alliance.SELF, Alliance.ENEMY].includes(unit.alliance)) {
        healthTrackingService.healthOfUnits[unit.alliance] = healthTrackingService.healthOfUnits[unit.alliance] || {};
        healthTrackingService.healthOfUnits[unit.alliance][unit.tag] = {
          health: unit.health,
          shield: unit.shield,
          totalHealth: unit.health + unit.shield,
          healthDifference: 0,
          differenceList: [],
          dPSList: [],
        };
      }
    });
  },
  async onStep(world) {
    // Update the health of all units and health difference in the world for each alliance.
    const { units } = world.resources.get();
    healthTrackingService.healthDifference[Alliance.SELF].push(0);
    healthTrackingService.healthDifference[Alliance.ENEMY].push(0);
    healthTrackingService.dPSOfUnits[Alliance.SELF].push(0);
    healthTrackingService.dPSOfUnits[Alliance.ENEMY].push(0);
    measureAndAssignHealthDifference(world);
    // for each unit, get total health difference for allied units within 16 distance and set it to allied health difference.
    setAlliedHealthDifference(units);
    units.getAlive().forEach(unit => {
      // set difference of health between current and new health
      const { alliance, health, pos, shield, tag, unitType } = unit;
      if (alliance === undefined || health === undefined || pos === undefined || shield === undefined || tag === undefined || unitType === undefined) return;
      if ([Alliance.SELF, Alliance.ENEMY].includes(alliance)) {
        let healthDifference = 0;
        let dPS = 0;
        const unitTracked = healthTrackingService.healthOfUnits[unit.alliance][tag];
        if (unitTracked) {
          healthDifference = health + shield - healthTrackingService.healthOfUnits[alliance][tag]["totalHealth"];
          const [closestEnemyUnit] = units.getClosest(pos, units.getAlive(alliance === Alliance.SELF ? Alliance.ENEMY : Alliance.SELF));
          if (closestEnemyUnit) {
            dPS = getWeaponDPS(world, unitType, alliance, closestEnemyUnit['enemyUnits'].map((/** @type {Unit} */ unit) => unit.unitType));
          }
        }
        // add health difference to last item
        healthTrackingService.healthDifference[unit.alliance][healthTrackingService.healthDifference[unit.alliance].length - 1] += healthDifference;
        healthTrackingService.healthOfUnits[unit.alliance][tag] = {
          health,
          shield,
          totalHealth: health + shield,
          /** @type {number[]} */
          differenceList: unitTracked ? [...unitTracked.differenceList, healthDifference] : [healthDifference],
          dPSList: unitTracked ? [...unitTracked.dPSList, dPS] : [dPS],
          getAverageDifference: () => unitTracked.differenceList.slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5),
          getAverageDPS: () => unitTracked.dPSList.slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5),
        };
      }
    });
  },
  async onUnitCreated(_world, unit) {
    // Store the initial health of the unit in the world for each alliance.
    if (unit.alliance === Alliance.SELF) {
      healthTrackingService.healthOfUnits[unit.alliance] = healthTrackingService.healthOfUnits[unit.alliance] || {};
      healthTrackingService.healthOfUnits[unit.alliance][unit.tag] = {
        health: unit.health,
        shield: unit.shield,
        totalHealth: unit.health + unit.shield,
        healthDifference: 0,
        differenceList: [],
        dPSList: [],
        getAverageDifference: () => [].slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5),
        getAverageDPS: () => [].slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5),
      };
    }
  },
  async onEnemyFirstSeen(_world, unit) {
    // Store the initial health of the unit in the world for each alliance.
    if (Alliance.ENEMY === unit.alliance) {
      healthTrackingService.healthOfUnits[unit.alliance] = healthTrackingService.healthOfUnits[unit.alliance] || {};
      healthTrackingService.healthOfUnits[unit.alliance][unit.tag] = {
        health: unit.health,
        shield: unit.shield,
        totalHealth: unit.health + unit.shield,
        healthDifference: 0,
        differenceList: [],
        dPSList: [],
        getAverageDifference: () => [].slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5),
        getAverageDPS: () => [].slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5),
      };
    }
  },
  async onUnitDestroyed(_world, unit) {
    // Remove the unit's health from the world for each alliance.
    if ([Alliance.SELF, Alliance.ENEMY].includes(unit.alliance)) {
      const healthDifference = 0 - healthTrackingService.healthOfUnits[unit.alliance][unit.tag]["totalHealth"];
      healthTrackingService.healthDifference[unit.alliance].push(healthDifference);
      delete healthTrackingService.healthOfUnits[unit.alliance][unit.tag];
    }
  },
});

/**
 * @param {World} world 
 * @returns {void}
 */
function measureAndAssignHealthDifference(world) {
  const { units } = world.resources.get();
  units.getAlive().forEach(unit => {
    const { alliance, health, pos, shield, tag, unitType } = unit;
    if (alliance === undefined || health === undefined || pos === undefined || shield === undefined || tag === undefined || unitType === undefined) return;
    if ([Alliance.SELF, Alliance.ENEMY].includes(alliance)) {
      let healthDifference = 0;
      const unitTracked = healthTrackingService.healthOfUnits[alliance][tag];
      if (unitTracked) {
        healthDifference = health + shield - unitTracked.totalHealth;
        unitTracked.health = health;
        unitTracked.shield = shield;
        unitTracked.totalHealth = health + shield;
        unitTracked.healthDifference = healthDifference;
        unitTracked.differenceList.push(healthDifference);
        const [closestEnemyUnit] = units.getClosest(pos, units.getAlive(alliance === Alliance.SELF ? Alliance.ENEMY : Alliance.SELF));
        if (closestEnemyUnit) {
          unitTracked.dPSList.push(getWeaponDPS(world, unitType, alliance, closestEnemyUnit['enemyUnits'].map((/** @type {Unit} */ unit) => unit.unitType)));
        }
      } else {
        healthTrackingService.healthOfUnits[alliance][tag] = {
          health: health,
          shield: shield,
          totalHealth: health + shield,
          healthDifference: 0,
          differenceList: [],
          dPSList: [],
        };
      }
    }
  });
}

/**
 * @param {UnitResource} units
 * @returns {void}
 */
function setAlliedHealthDifference(units) {
  units.getAlive().forEach(unit => {
    const { alliance, pos, tag } = unit;
    if (alliance === undefined || pos === undefined || tag === undefined) return;
    if ([Alliance.SELF, Alliance.ENEMY].includes(alliance)) {
      const alliedUnits = units.getAlive(alliance).filter(unit => unit.tag !== tag && unit.pos && distance(pos, unit.pos) <= 16);
      // set allied health difference by averaging the last 14 values of differenceList
      const alliedHealthDifference = alliedUnits.reduce((/** @type {number} */ acc, /** @type {Unit} */ unit) => {
        return acc + healthTrackingService.healthOfUnits[alliance][unit.tag].differenceList.slice(-14).reduce((/** @type {number} */ acc, /** @type {number} */ curr) => acc + curr, 0) / (14 / 5);
      }, 0);
      // const alliedHealthDifference = alliedUnits.reduce((acc, unit) => acc + healthTrackingService.healthOfUnits[alliance][unit.tag].healthDifference, 0);
      // set allied health difference to allied health difference.
      healthTrackingService.alliedHealthDifference[alliance][tag] = alliedHealthDifference;
    }
  });
}