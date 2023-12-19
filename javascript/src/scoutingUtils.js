// @ts-check
"use strict";

// scoutingUtils.js

// Core SC2 constants and utilities
const { Ability } = require('@node-sc2/core/constants');

// Shared utility functions
const { getDistance } = require('./geometryUtils');
const { findEnemyBase } = require('./mapUtils');
const { calculateDistance } = require('./utils/coreUtils');

/**
 * Array to keep track of mapped enemy units.
 * @type {Unit[]}
 */
const mappedEnemyUnits = [];

/**
 * Finds enemy units near a given unit.
 * @param {UnitResource} units - The units resource object from the bot.
 * @param {Unit} unit - The unit to check for nearby enemy units.
 * @param {number} radius - The radius to check for enemy units.
 * @returns {Unit[]} Array of enemy units near the given unit.
 */
function findEnemyUnitsNear(units, unit, radius) {
  if (!unit.pos) return [];
  const enemyUnits = Array.from(units._units[4].values()); // 4 represents Enemy

  return enemyUnits.filter(enemyUnit => {
    const distance = getDistance(unit.pos, enemyUnit.pos);
    return distance !== undefined && distance < radius;
  });
}

/**
 * Prepares scouting actions for a worker to scout the enemy base.
 * @param {World} world - The game context, including resources and actions.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of action commands for scouting.
 */
function prepareEarlyScouting(world) {
  const { units, map } = world.resources.get();

  const workers = units.getMineralWorkers();
  const mainBaseLocation = map.getMain().townhallPosition;

  const scoutActions = [];
  const scout = selectScout(workers, mainBaseLocation);

  if (scout && scout.tag) {
    const enemyBaseLocation = findEnemyBase(map, mainBaseLocation);
    if (enemyBaseLocation) {
      const moveCommand = {
        abilityId: Ability.MOVE,
        targetWorldSpacePos: enemyBaseLocation,
        unitTags: [scout.tag],
      };
      scoutActions.push(moveCommand);
    }
  }

  return scoutActions;
}

/**
 * Selects a suitable worker to perform scouting based on distance from the main base.
 * @param {Unit[]} workers - Array of worker units.
 * @param {Point2D} mainBaseLocation - Location of the main base.
 * @returns {Unit | null} - Selected scout or null if no suitable worker found.
 */
function selectScout(workers, mainBaseLocation) {
  if (workers.length === 0 || !mainBaseLocation) {
    return null;
  }

  let selectedScout = null;
  let minDistance = Infinity;

  for (const worker of workers) {
    if (worker.pos) {
      const distance = calculateDistance(worker.pos, mainBaseLocation);
      if (distance < minDistance) {
        selectedScout = worker;
        minDistance = distance;
      }
    }
  }

  return selectedScout;
}

// Export the function(s)
module.exports = {
  mappedEnemyUnits,
  findEnemyUnitsNear,
  prepareEarlyScouting,
};