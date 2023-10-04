// /src/services/army-management/army-management-service.js

const groupTypes = require("@node-sc2/core/constants/groups");
const { getDistance, moveAwayPosition } = require("../../../services/position-service");
const enemyTrackingService = require("../../../systems/enemy-tracking/enemy-tracking-service");
const unitService = require("../../../services/unit-service");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getDistanceByPath } = require("../../../services/resource-manager-service");
const { createUnitCommand } = require("../../../services/actions-service");
const { MOVE } = require("@node-sc2/core/constants/ability");

class ArmyManagementService {
  constructor() {
    // Initialization code, setting up variables, etc.
  }

  /**
   * Determines the actions for micro-management of a unit in response to a target unit and other nearby threats.
   * 
   * @param {World} world - The current game world state.
   * @param {Unit} unit - The unit to be micro-managed.
   * @param {Unit} targetUnit - The primary target unit to engage or evade.
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of raw unit commands for the micro-management actions.
   */
  getActionsForMicro(world, unit, targetUnit) {
    const { resources } = world;
    const { map } = resources.get();

    const nearbyThreats = findNearbyThreats(world, unit, targetUnit);
    const allThreats = [targetUnit, ...nearbyThreats];

    const optimalDistance = getOptimalAttackDistance(world, unit, allThreats);

    const relevantThreats = allThreats.filter(threat =>
      getDistance(unit.pos, threat.pos) < optimalDistance
    );

    if (!relevantThreats.length) return [];

    const threatPositions = relevantThreats.flatMap(target =>
      findPositionsInRangeOfEnemyUnits(world, unit, [target])
    );

    const safePositions = threatPositions.filter(position =>
      relevantThreats.every(threat =>
        getDistance(position, threat.pos) >= optimalDistance
      )
    );

    const projectedTargetPositions = relevantThreats.map(targetUnit => {
      const targetPositions = enemyTrackingService.enemyUnitsPositions.get(targetUnit.tag);
      return targetPositions ? getProjectedPosition(
        targetPositions.current.pos,
        targetPositions.previous.pos,
        targetPositions.current.lastSeen,
        targetPositions.previous.lastSeen
      ) : targetUnit.pos;
    });

    const combinedThreatPosition = avgPoints(projectedTargetPositions);

    const closestSafePosition = safePositions.length > 0 ?
      safePositions.reduce((closest, position) =>
        getDistanceByPath(resources, combinedThreatPosition, position) <
          getDistanceByPath(resources, combinedThreatPosition, closest) ? position : closest
      ) : moveAwayPosition(map, combinedThreatPosition, unit.pos);

    const unitCommand = createUnitCommand(MOVE, [unit]);
    unitCommand.targetWorldSpacePos = closestSafePosition;

    return [unitCommand];
  }

}

module.exports = new ArmyManagementService();

/**
 * Identify enemy units in proximity to a primary target.
 *
 * @param {World} _world The current game state.
 * @param {Unit} _unit The unit we're focusing on.
 * @param {Unit} targetUnit The primary enemy unit we're concerned about.
 * @returns {Unit[]} Array of enemy units near the target.
 */
function findNearbyThreats(_world, _unit, targetUnit) {
  const NEARBY_THRESHOLD = 16; // Define the threshold value based on the game's logic

  // Use the enemy tracking service to get all enemy units
  const allEnemyUnits = enemyTrackingService.mappedEnemyUnits;

  return allEnemyUnits.filter((enemy) => {
    const { tag, pos } = enemy;

    // Use early returns to filter out non-threatening or irrelevant units
    if (tag === targetUnit.tag || isNonThreateningUnit(enemy)) {
      return false;
    }

    // Check proximity to target unit
    return getDistance(pos, targetUnit.pos) <= NEARBY_THRESHOLD;
  });
}
/**
 * Determine if the provided unit is considered non-threatening, such as workers.
 *
 * @param {Unit} unit - The unit to evaluate.
 * @returns {boolean} - True if the unit is non-threatening; otherwise, false.
 */
function isNonThreateningUnit(unit) {
  return groupTypes.workerTypes.includes(unit.unitType);
}

/**
 * Calculates the optimal distance a unit should maintain from enemies to effectively utilize its attack range and their sizes.
 *
 * @param {World} world - The current state of the game world.
 * @param {Unit} unit - The unit being controlled.
 * @param {Unit[]} enemies - Array of enemy units that pose a threat.
 * @returns {number} - The calculated optimal distance from the enemies, considering both attack range and unit sizes.
 * @throws {Error} When there is no weapon data available for the given unit.
 */
function getOptimalAttackDistance(world, unit, enemies) {
  if (!enemies.length) {
    throw new Error('No enemies provided');
  }

  const { data } = world;

  // Handle the case where weapon or range data is not available
  const unitWeapon = unitService.getWeaponThatCanAttack(data, unit.unitType, enemies[0]);
  if (!unitWeapon || typeof unitWeapon.range !== 'number') {
    throw new Error('Weapon data unavailable for the specified unit');
  }

  const unitAttackRange = unitWeapon.range;
  const enemyAttackRanges = enemies.map(enemy => {
    const enemyWeapon = unitService.getWeaponThatCanAttack(data, enemy.unitType, unit);
    return enemyWeapon && typeof enemyWeapon.range === 'number' ? enemyWeapon.range : 0;
  });

  // Calculate the minimum attack range among enemies and include unit/threat sizes
  const minEnemyAttackRange = Math.min(...enemyAttackRanges);
  const unitRadius = unit.radius || 0; // Assume default unit radius property; replace as needed
  const threatRadius = enemies[0].radius || 0; // Assume default threat radius property; replace as needed

  return unitAttackRange + minEnemyAttackRange + unitRadius + threatRadius;
}

/**
 * @description Returns positions that are in range of the unit's weapons from enemy units.
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Point2D[]}
 */
function findPositionsInRangeOfEnemyUnits(world, unit, enemyUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { enemyUnitsPositions } = enemyTrackingService;
  const { getWeaponThatCanAttack } = unitService;
  const { pos, radius, unitType } = unit; if (pos === undefined || radius === undefined || unitType === undefined) return [];
  return enemyUnits.reduce((/** @type {Point2D[]} */ acc, enemyUnit) => {
    const { pos: enemyUnitPos, radius: enemyUnitRadius, tag, unitType: enemyUnitType } = enemyUnit;
    if (enemyUnitPos === undefined || enemyUnitRadius === undefined || tag === undefined || enemyUnitType === undefined) { return acc; }
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, enemyUnit); if (weaponThatCanAttack === undefined) { return acc; }
    const { range } = weaponThatCanAttack; if (range === undefined) { return acc; }
    const targetPositions = enemyUnitsPositions.get(tag);
    if (targetPositions === undefined) {
      const pointsInRange = getPointsInRange(enemyUnitPos, range + radius + enemyUnitRadius);
      acc.push(...pointsInRange);
      return acc;
    }
    const projectedEnemyUnitPos = getProjectedPosition(targetPositions.current.pos, targetPositions.previous.pos, targetPositions.current.lastSeen, targetPositions.previous.lastSeen);
    const pointsInRange = getPointsInRange(projectedEnemyUnitPos, range + radius + enemyUnitRadius);
    const pathablePointsInRange = pointsInRange.filter(point => map.isPathable(point));
    acc.push(...pathablePointsInRange);
    return acc;
  }, []);
}
/**
 * @description Returns boolean if the unit is in range of the enemy unit's weapons.
 * @param {Point2D} position
 * @param {number} range
 * @returns {Point2D[]}
 */
function getPointsInRange(position, range) {
  const { x, y } = position; if (x === undefined || y === undefined) return [];
  // get points around enemy unit that are in range of the unit's weapons, at least 16 points
  const pointsInRange = [];
  for (let i = 0; i < 16; i++) {
    const angle = i * 2 * Math.PI / 16;
    const point = {
      x: x + range * Math.cos(angle),
      y: y + range * Math.sin(angle),
    };
    pointsInRange.push(point);
  }
  return pointsInRange;
}
/**
 * @description Returns projected position of unit.
 * @param {Point2D} pos
 * @param {Point2D} pos1
 * @param {number} time
 * @param {number} time1
 * @param {number} [stepSize=8]
 * @returns {Point2D}
 */
function getProjectedPosition(pos, pos1, time, time1, stepSize = 8) {
  const { x, y } = pos; if (x === undefined || y === undefined) return pos;
  const { x: x1, y: y1 } = pos1; if (x1 === undefined || y1 === undefined) return pos;
  const timeDiff = time1 - time;
  if (timeDiff === 0) return pos;
  const adjustedTimeDiff = timeDiff / stepSize;
  const xDiff = x1 - x;
  const yDiff = y1 - y;
  const projectedPosition = {
    x: x + xDiff / adjustedTimeDiff,
    y: y + yDiff / adjustedTimeDiff,
  };
  return projectedPosition;
}