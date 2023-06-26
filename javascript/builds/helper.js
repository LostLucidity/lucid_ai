//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { OVERLORD, COLOSSUS } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { existsInMap } = require("../helper/location");
const { createUnitCommand } = require("../services/actions-service");
const { getTimeInSeconds } = require("../services/frames-service");
const { moveAwayPosition, getDistance } = require("../services/position-service");
const { getClosestUnitByPath } = require("../services/resource-manager-service");
const { canAttack } = require("../services/resources-service");
const { getMovementSpeed } = require("../services/unit-service");
const { retreat, getDPSOfInRangeAntiAirUnits } = require("../services/world-service");
const { isWorker } = require("../systems/unit-resource/unit-resource-service");

const helper = {
  /**
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} distance 
   * @returns {SC2APIProtocol.ActionRawUnitCommand}
   */
  moveAway(unit, targetUnit, distance = 2) {
    const unitCommand = createUnitCommand(MOVE, [unit]);
    const { pos } = unit;
    const { pos: targetPos } = targetUnit; if (pos === undefined || targetPos === undefined) return unitCommand;
    const awayPoint = moveAwayPosition(targetPos, pos, distance);
    unitCommand.targetWorldSpacePos = awayPoint;
    return unitCommand;
  },
  /**
   * @param {World} world 
   * @param {Unit[]} shadowingUnits 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  shadowEnemy(world, shadowingUnits) {
    const { data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY);

    /** @type {(unitType: number) => number} */
    const maxWeaponRange = (unitType) => {
      const weaponsData = data.getUnitTypeData(unitType)?.weapons;
      if (!weaponsData) return 0;
      return weaponsData.reduce((maxRange, weapon) => {
        return weapon.range !== undefined && weapon.range > maxRange ? weapon.range : maxRange;
      }, 0);
    };

    shadowingUnits.forEach(unit => {
      const { pos } = unit; if (pos === undefined) return;
      const inRangeUnits = enemyUnits.reduce((/** @type {{ unit: Unit, dist: number }[]} */acc, enemyUnit) => {
        const { pos: enemyPos } = enemyUnit; if (enemyPos === undefined) return acc;
        const { sightRange } = enemyUnit.data(); if (sightRange === undefined) return acc;
        const enemyRadius = enemyUnit.radius || 0;
        const unitRadius = unit.radius || 0;
        const rawDistance = getDistance(pos, enemyPos);
        const dist = rawDistance - enemyRadius - unitRadius;
        if (dist < sightRange) {
          acc.push({
            unit: enemyUnit,
            dist: dist
          });
        }
        return acc;
      }, []);

      const [closestInRangeUnit] = units.getClosest(pos, inRangeUnits.map(u => u.unit));

      const inRangeThreateningUnits = inRangeUnits.filter(({ unit: inRangeUnit }) => inRangeUnit.canShootUp()).sort((a, b) => {
        const distanceToRangeA = a.dist - maxWeaponRange(a.unit.unitType);
        const distanceToRangeB = b.dist - maxWeaponRange(b.unit.unitType);
        return distanceToRangeA - distanceToRangeB;
      });

      const [closestThreatUnit] = inRangeThreateningUnits;

      const unitsToAvoid = [...inRangeThreateningUnits, ...inRangeUnits].map(u => u.unit);

      const unitToShadow = (closestThreatUnit && closestThreatUnit.unit) || closestInRangeUnit || null;
      const shouldShadow = unitToShadow && checkIfShouldShadow(resources, unit, shadowingUnits, unitToShadow);
      if (shouldShadow) {
        if (unitsToAvoid.length > 0) {
          if (closestThreatUnit && closestThreatUnit.unit.pos && getDistance(pos, closestThreatUnit.unit.pos) > closestThreatUnit.unit.data().sightRange + unit.radius + closestThreatUnit.unit.radius) {
            collectedActions.push(moveToTarget(unit, closestThreatUnit.unit));
          } else if (closestInRangeUnit && !closestToNaturalBehavior(resources, shadowingUnits, unit, closestInRangeUnit)) {
            if (inRangeUnits.every(({ dist, unit: inRangeUnit }) => dist > inRangeUnit.data().sightRange + unit.radius + inRangeUnit.radius)) {
              collectedActions.push(moveToTarget(unit, closestInRangeUnit));
            } else {
              collectedActions.push(moveAwayFromTarget(world, unit, unitsToAvoid));
            }
          } else {
            collectedActions.push(moveAwayFromTarget(world, unit, unitsToAvoid));
          }
        }
      }
    });

    return collectedActions;
  }
}

module.exports = helper;

function closestToNaturalBehavior(resources, shadowingUnits, unit, targetUnit) {
  const { map, units } = resources.get();
  const [closestToEnemyNatural] = units.getClosest(map.getEnemyNatural().centroid, shadowingUnits);
  const outOfNaturalRangeWorker = isWorker(targetUnit) && distance(targetUnit.pos, map.getEnemyNatural().centroid) > 16;
  if (closestToEnemyNatural) {
    if (
      unit.tag === closestToEnemyNatural.tag &&
      (outOfNaturalRangeWorker || targetUnit.unitType === OVERLORD)
    ) { return true; }
  }
}

/**
 * 
 * @param {World} world 
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits 
 * @returns {SC2APIProtocol.ActionRawUnitCommand | null}
 */
function moveAwayFromTarget(world, unit, targetUnits) {
  const { resources } = world;
  const { units } = resources.get();
  const { isFlying, pos, tag } = unit; if (isFlying === undefined || pos === undefined || tag === undefined) return null;
  if (pos === undefined) { return null; }

  let position;
  if (isFlying) {
    position = getFlyingUnitPosition(world, unit, targetUnits);
    if (!position) {
      const averageEnemyPos = avgPoints(targetUnits.map(unit => unit.pos));
      position = moveAwayPosition(averageEnemyPos, pos);
    }
  } else {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const [closestTargetUnit] = getClosestUnitByPath(resources, pos, enemyUnits)
    position = retreat(world, unit, closestTargetUnit);
  }
  return {
    abilityId: MOVE,
    targetWorldSpacePos: position,
    unitTags: [tag],
  }
}

function moveToTarget(unit, targetUnit) {
  if (unit.health / unit.healthMax > 0.5) {
    return {
      abilityId: MOVE,
      targetUnitTag: targetUnit.tag,
      unitTags: [unit.tag]
    }
  }
}

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {Unit[]} shadowingUnits
 * @param {Unit} targetUnit
 * @returns {boolean}
 */
function checkIfShouldShadow(resources, unit, shadowingUnits, targetUnit) {
  const { frame, map, units } = resources.get();
  const { centroid } = map.getEnemyNatural(); if (centroid === undefined) return false;
  const [closestToEnemyNatural] = units.getClosest(centroid, shadowingUnits);
  const isClosestToEnemyNatural = closestToEnemyNatural && unit.tag === closestToEnemyNatural.tag;
  if (!isClosestToEnemyNatural) return true;
  const { pos } = targetUnit; if (pos === undefined) return false;
  const inRangeOfNaturalWorker = isWorker(targetUnit) && getDistance(pos, centroid) <= 16;
  const isGameTimeLaterThanTargetTime = getTimeInSeconds(frame.getGameLoop()) >= 131;
  const canBeAttacked = canAttack(targetUnit, unit);
  const shouldClosestToEnemyNaturalShadow = (
    (canBeAttacked || isGameTimeLaterThanTargetTime) &&
    (inRangeOfNaturalWorker || !isWorker(targetUnit))
  );
  return shouldClosestToEnemyNaturalShadow;
}

/**
 * Returns position for flying unit
 * @param {World} world
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits 
 * @returns {Point2D | undefined}
 */
function getFlyingUnitPosition(world, unit, targetUnits) {
  const { resources } = world;
  const { map } = resources.get();
  const { health, shield, pos } = unit; if (health === undefined || shield === undefined || pos === undefined) return;
  const highPointCandidates = getHighPointCandidates(map, unit, targetUnits);

  const [closestHighPoint] = getClosestPosition(pos, highPointCandidates);

  if (closestHighPoint) {
    const dPSOfInRangeUnits = getDPSOfInRangeAntiAirUnits(world, unit);
    const timeToBeKilled = (health + shield) / dPSOfInRangeUnits;
    const distanceToHighPoint = distance(pos, closestHighPoint);
    const speed = getMovementSpeed(unit); if (speed === undefined) return;
    const timeToTarget = distanceToHighPoint / speed;
    if (timeToBeKilled > timeToTarget) {
      return closestHighPoint;
    }
  }
}

/**
 * Returns a list of high point grid positions that the flying unit could move to.
 * @param {MapResource} map
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits 
 * @returns {Point2D[]}
 */
function getHighPointCandidates(map, unit, targetUnits) {
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return [];
  const { sightRange } = unit.data(); if (sightRange === undefined) return [];
  return gridsInCircle(pos, sightRange).filter(grid => {
    if (existsInMap(map, grid)) {
      const gridHeight = map.getHeight(grid);
      const circleCandidates = gridsInCircle(grid, radius).filter(candidate =>
        existsInMap(map, candidate) && distance(candidate, grid) <= radius);

      const isVisibleToAnyTargetUnit = targetUnits.some(targetUnit => {
        const { pos: targetPos, radius: targetRadius } = targetUnit; if (targetPos === undefined || targetRadius === undefined) return true;
        const { sightRange: targetSightRange } = targetUnit.data(); if (targetSightRange === undefined) return true;
        const { z } = targetPos; if (z === undefined) return true;
        const unitInSightRange = getDistance(targetPos, grid) <
          targetSightRange + radius + targetRadius;
        return unitInSightRange &&
          (targetUnit.isFlying || targetUnit.unitType === COLOSSUS || Math.round(z) + 2 > gridHeight);
      });

      return !isVisibleToAnyTargetUnit &&
        circleCandidates.every(adjacentGrid => map.getHeight(adjacentGrid) >= gridHeight);
    }
  });
}

