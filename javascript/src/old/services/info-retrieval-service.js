//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getDistance } = require("../../services/position-service");
const unitService = require("../../services/unit-service");
const trackUnitsService = require("../../systems/track-units/track-units-service");
const { calculateNearDPSHealth } = require("./combat-statistics");
const { getSelfUnits } = require("./unit-retrieval/unit-retrieval-service");
const enemyTrackingService = require("./enemy-tracking");

// info-retrieval-service.js

class InfoRetrievalService {
  constructor() {

  }

  /**
   * Retrieve the DPS health information about a unit.
   * @param {World} world
   * @param {Unit} unit
   * @returns {number}
   */
  getSelfDPSHealth(world, unit) {
    const { resources } = world;
    const { units } = resources.get();
    const { selfDPSHealth } = unitService;
    const { pos, alliance, tag } = unit; 

    if (pos === undefined || alliance === undefined || tag === undefined) return 0;
    if (selfDPSHealth.has(tag)) return selfDPSHealth.get(tag) || 0;

    const targetUnits = alliance === Alliance.ENEMY ? enemyTrackingService.mappedEnemyUnits : trackUnitsService.selfUnits;
    const [closestEnemyUnit] = units.getClosest(pos, targetUnits).filter(enemyUnit => enemyUnit.pos && getDistance(enemyUnit.pos, pos) <= 16);

    const enemyUnitSelfUnitTypes = closestEnemyUnit ? getSelfUnits(units, closestEnemyUnit, enemyTrackingService.mappedEnemyUnits).reduce((/** @type {UnitTypeId[]} */acc, enemyUnitSelfUnit) => {
        const { unitType } = enemyUnitSelfUnit;
        if (unitType !== undefined) acc.push(unitType);
        return acc;
    }, []) : [];

    const dpsHealth = calculateNearDPSHealth(world, getSelfUnits(units, unit, enemyTrackingService.mappedEnemyUnits), enemyUnitSelfUnitTypes);
    unitService.selfDPSHealth.set(tag, dpsHealth);
    return dpsHealth;
  }

}

// Exporting the class itself
module.exports = new InfoRetrievalService();