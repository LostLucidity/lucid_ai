// src/features/shared/movementUtils.js

const { Buff, UnitType } = require("@node-sc2/core/constants");

const { SPEED_MODIFIERS } = require("../core/constants");
const { getClosestPathablePositionsBetweenPositions } = require("../core/pathfindingCore");
const { getDistanceByPath } = require("../features/shared/pathfinding/pathfindingCore");
// eslint-disable-next-line no-unused-vars
const { GameState } = require("../state");
const { getMovementSpeedByType, ZERG_UNITS_ON_CREEP_BONUS } = require("../units/management/unitConfig");
const { getDistance } = require("../utils/spatialCoreUtils");

/**
 * Constants defined outside the function to avoid reinitialization on every call.
 */
const NO_CREEP_BONUS_TYPES = new Set([UnitType.DRONE, UnitType.BROODLING, UnitType.CHANGELING /* and any burrowed unit type */]);
const DEFAULT_CREEP_SPEED_BONUS = 1.3;

/**
 *
 * @param {ResourceManager} resources
 * @param {Point2D|SC2APIProtocol.Point} position
 * @param {Unit[]} units
 * @param {Unit[]} gasGeysers
 * @param {number} n
 * @returns {Unit[]}
 */
function getClosestUnitByPath(resources, position, units, gasGeysers = [], n = 1) {
  const { map } = resources.get();

  const splitUnits = units.reduce((/** @type {{within16: Unit[], outside16: Unit[]}} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    // Use a fallback value if getDistance returns undefined
    const distanceToUnit = getDistance(pos, position) || Number.MAX_VALUE;
    const pathablePosData = getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const distanceByPath = getDistanceByPath(resources, pathablePosData.pathablePosition, pathablePosData.pathableTargetPosition) || Number.MAX_VALUE;

    const isWithin16 = distanceToUnit <= 16 && distanceByPath <= 16;
    return {
      within16: isWithin16 ? [...acc.within16, unit] : acc.within16,
      outside16: isWithin16 ? acc.outside16 : [...acc.outside16, unit]
    };
  }, { within16: [], outside16: [] });

  let closestUnits = splitUnits.within16.sort((a, b) => {
    const { pos } = a; if (pos === undefined) return 1;
    const { pos: bPos } = b; if (bPos === undefined) return -1;
    const aData = getClosestPathablePositionsBetweenPositions(resources, pos, position, gasGeysers);
    const bData = getClosestPathablePositionsBetweenPositions(resources, bPos, position, gasGeysers);
    return getDistanceByPath(resources, aData.pathablePosition, aData.pathableTargetPosition) - getDistanceByPath(resources, bData.pathablePosition, bData.pathableTargetPosition);
  });

  if (n === 1 && closestUnits.length > 0) return closestUnits;

  const unitsByDistance = [...closestUnits, ...splitUnits.outside16].reduce((/** @type {{unit: Unit, distance: number}[]} */acc, unit) => {
    const { pos } = unit;
    if (pos === undefined) return acc;

    const expansionWithin16 = map.getExpansions().find(expansion => {
      const { centroid: expansionPos } = expansion;
      if (expansionPos === undefined) return false;

      const pathablePosData = getClosestPathablePositionsBetweenPositions(resources, expansionPos, pos, gasGeysers);
      if (!pathablePosData) return false;

      // Use fallback values if getDistance or pathablePosData.distance returns undefined
      const distanceToExpansion = getDistance(expansionPos, pos) || Number.MAX_VALUE;
      const distanceByPath = pathablePosData.distance || Number.MAX_VALUE;

      return distanceToExpansion <= 16 && distanceByPath <= 16;
    });

    if (!expansionWithin16 || !expansionWithin16.centroid) return acc;
    const closestPathablePositionBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, expansionWithin16.centroid, position, gasGeysers);
    if (!closestPathablePositionBetweenPositions) return acc;

    // Add only if closestPathablePositionBetweenPositions.distance is defined
    if (typeof closestPathablePositionBetweenPositions.distance === 'number') {
      acc.push({ unit, distance: closestPathablePositionBetweenPositions.distance });
    }
    return acc;
  }, []).sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.distance - b.distance;
  });

  return unitsByDistance.slice(0, n).map(u => u.unit);
}

/**
 * Calculates the movement speed of a unit based on various factors.
 * @param {MapResource} map The map resource object.
 * @param {Unit} unit The unit for which to calculate movement speed.
 * @param {GameState} gameState The current game state.
 * @param {boolean} adjustForRealSeconds Adjusts speed for real-time seconds.
 * @returns {number} The movement speed of the unit.
 */
function getMovementSpeed(map, unit, gameState, adjustForRealSeconds = false) {
  const { pos, unitType } = unit;
  if (!pos || !unitType) return 0;

  let movementSpeed = getMovementSpeedByType(unit);
  if (!movementSpeed) return 0;

  // Start with a base multiplier and conditionally modify it
  let multiplier = adjustForRealSeconds ? 1.4 : 1;
  if (unit.buffIds?.includes(Buff.STIMPACK)) {
    multiplier *= 1.5;
  }
  if (map.hasCreep(pos) && !NO_CREEP_BONUS_TYPES.has(unitType)) {
    multiplier *= ZERG_UNITS_ON_CREEP_BONUS.get(unitType) || DEFAULT_CREEP_SPEED_BONUS;
  }

  const speedModifierFunc = SPEED_MODIFIERS.get(unitType);
  if (speedModifierFunc) {
    movementSpeed += speedModifierFunc(unit, gameState);
  }

  return movementSpeed * multiplier;
}

module.exports = {
  getMovementSpeed,
  getClosestUnitByPath,
};
