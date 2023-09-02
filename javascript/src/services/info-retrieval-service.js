//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { getDistance } = require("../../services/position-service");
const unitService = require("../../services/unit-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const trackUnitsService = require("../../systems/track-units/track-units-service");
const unitResourceService = require("../../systems/unit-resource/unit-resource-service");
const worldService = require("../world-service");

// info-retrieval-service.js

class InfoRetrievalService {
    constructor() {
        // Any initializations if needed.
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
        const { getSelfUnits } = unitResourceService;
        const { selfDPSHealth } = unitService;
        const { pos, alliance, tag } = unit; 

        if (pos === undefined || alliance === undefined || tag === undefined) return 0;
        if (selfDPSHealth.has(tag)) return selfDPSHealth.get(tag) || 0;

        const targetUnits = alliance === Alliance.ENEMY ? enemyTrackingService.mappedEnemyUnits : trackUnitsService.selfUnits;
        const [closestEnemyUnit] = units.getClosest(pos, targetUnits).filter(enemyUnit => enemyUnit.pos && getDistance(enemyUnit.pos, pos) <= 16);

        const enemyUnitSelfUnitTypes = closestEnemyUnit ? getSelfUnits(units, closestEnemyUnit).reduce((/** @type {UnitTypeId[]} */acc, enemyUnitSelfUnit) => {
            const { unitType } = enemyUnitSelfUnit;
            if (unitType !== undefined) acc.push(unitType);
            return acc;
        }, []) : [];

        const dpsHealth = worldService.calculateNearDPSHealth(world, getSelfUnits(units, unit), enemyUnitSelfUnitTypes);
        unitService.selfDPSHealth.set(tag, dpsHealth);
        return dpsHealth;
    }

    // You can continue to add more methods/functions here as the InfoRetrievalService grows.

}

module.exports = new InfoRetrievalService();
