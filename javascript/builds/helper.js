//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { OVERLORD, COLOSSUS } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle, toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { existsInMap } = require("../helper/location");
const { createUnitCommand } = require("../services/actions-service");
const { getTimeInSeconds, getTravelDistancePerStep } = require("../services/frames-service");
const { moveAwayPosition, getDistance } = require("../services/position-service");
const { canAttack } = require("../services/resources-service");
const { getMovementSpeed } = require("../services/unit-service");
const { getDPSOfInRangeAntiAirUnits } = require("../src/world-service");
const { isWorker } = require("../systems/unit-resource/unit-resource-service");
const worldService = require("../src/world-service");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");

const helper = {
  /**
   * @param {MapResource} map
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} distance 
   * @returns {SC2APIProtocol.ActionRawUnitCommand}
   */
  moveAway(map, unit, targetUnit, distance = 2) {
    const unitCommand = createUnitCommand(MOVE, [unit]);
    const { pos } = unit;
    const { pos: targetPos } = targetUnit;
    if (!pos || !pos.x || !pos.y || !targetPos || !targetPos.x || !targetPos.y) return unitCommand;

    let awayPoint = moveAwayPosition(map, targetPos, pos, distance);

    if (awayPoint === null) {
      // Rotate and Retry
      for (let i = 0; i < 36; i++) {  // Trying 10 degrees at a time
        awayPoint = rotateAndFindPathablePoint(map, targetPos, pos, i * 10, distance);
        if (awayPoint !== null) break;
      }
    }

    if (awayPoint !== null) {
      unitCommand.targetWorldSpacePos = awayPoint;
    }

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
    const enemyUnits = enemyTrackingService.mappedEnemyUnits;

    shadowingUnits.forEach(unit => {
      const { pos } = unit;
      if (pos === undefined) return;

      const extraRangeFactor = worldService.outpowered ? 0.1 : 0; // increase by 10% if outpowered
      const inRangeUnits = calculateInRangeUnits(unit, enemyUnits, extraRangeFactor);

      const [closestInRangeUnit] = units.getClosest(pos, inRangeUnits.map(u => u.unit));

      const inRangeThreateningUnits = inRangeUnits.filter(({ unit: inRangeUnit }) => inRangeUnit.canShootUp()).sort((a, b) => {
        const distanceToRangeA = a.dist - maxWeaponRange(data, a.unit.unitType);
        const distanceToRangeB = b.dist - maxWeaponRange(data, b.unit.unitType);
        return distanceToRangeA - distanceToRangeB;
      });

      const [closestThreatUnit] = inRangeThreateningUnits;

      const unitsToAvoid = [...inRangeThreateningUnits, ...inRangeUnits].map(u => u.unit);

      const unitToShadow = (closestThreatUnit && closestThreatUnit.unit) || closestInRangeUnit || null;
      const shouldShadow = unitToShadow && checkIfShouldShadow(resources, unit, shadowingUnits, unitToShadow);

      if (shouldShadow && unitsToAvoid.length > 0) {
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
  const { map } = resources.get();
  const { isFlying, pos, tag } = unit;

  if (isFlying === undefined || pos === undefined || tag === undefined) return null;
  const { x, y } = pos;
  if (x === undefined || y === undefined) return null;

  const maxDistance = getTravelDistancePerStep(map, unit) * 2;
  let position;

  if (isFlying) {
    position = getFlyingUnitPosition(world, unit, targetUnits) ||
      moveAwayPosition(map, avgPoints(targetUnits.map(u => u.pos)), pos, 2, true);

    if (position) {
      const newPosition = calculatePositionByDirection(pos, position, maxDistance);
      if (newPosition) {
        position = newPosition;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  return {
    abilityId: MOVE,
    targetWorldSpacePos: position,
    unitTags: [tag],
  };
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
  const elevatedPositions = getHiddenElevatedPositions(map, unit, targetUnits);

  const [closestHighPoint] = getClosestPosition(pos, elevatedPositions);

  if (closestHighPoint) {
    const dPSOfInRangeUnits = getDPSOfInRangeAntiAirUnits(world, unit);
    const timeToBeKilled = (health + shield) / dPSOfInRangeUnits;
    const distanceToHighPoint = distance(pos, closestHighPoint);
    const speed = getMovementSpeed(map, unit); if (speed === undefined) return;
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
function getHiddenElevatedPositions(map, unit, targetUnits) {
  const { pos, radius } = unit;
  if (pos === undefined || radius === undefined) return [];
  const { sightRange } = unit.data();
  if (sightRange === undefined) return [];

  // Get the highest height among all target units
  const highestTargetHeight = Math.max(...targetUnits.map(targetUnit => {
    const { pos: targetPos } = targetUnit; if (targetPos === undefined) return 0;
    const { z } = targetPos; return z !== undefined ? Math.round(z) : 0;
  }));

  return gridsInCircle(pos, Math.round(sightRange * 1.2)).filter(grid => {
    if (existsInMap(map, grid)) {
      const gridHeight = map.getHeight(grid);

      // Check if gridHeight is significantly higher than the highest target unit height
      if (gridHeight < highestTargetHeight + 2) return false;

      const circleCandidates = gridsInCircle(grid, radius).filter(candidate =>
        existsInMap(map, candidate) && distance(candidate, grid) <= radius);

      const isVisibleToAnyTargetUnit = targetUnits.some(targetUnit => {
        const { pos: targetPos, radius: targetRadius } = targetUnit;
        if (targetPos === undefined || targetRadius === undefined) return true;
        const { sightRange: targetSightRange } = targetUnit.data();
        if (targetSightRange === undefined) return true;
        const { z } = targetPos;
        if (z === undefined) return true;

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

/**
 * @param {DataStorage} data
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
const maxWeaponRange = (data, unitType) => {
  const weaponsData = data.getUnitTypeData(unitType)?.weapons;
  return weaponsData?.reduce((maxRange, weapon) => (weapon.range && weapon.range > maxRange) ? weapon.range : maxRange, 0) || 0;
};

/**
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @param {number} [extraRangeFactor]
 * @returns {{ unit: Unit, dist: number }[]}
 */
const calculateInRangeUnits = (unit, enemyUnits, extraRangeFactor = 0) => {
  const { pos } = unit;
  if (pos === undefined) return [];

  return enemyUnits.reduce((/** @type {{ unit: Unit, dist: number }[]} */acc, enemyUnit) => {
    const { pos: enemyPos } = enemyUnit;
    if (enemyPos === undefined) return acc;

    const { sightRange } = enemyUnit.data();
    if (sightRange === undefined) return acc;

    const enemyRadius = enemyUnit.radius || 0;
    const unitRadius = unit.radius || 0;
    const rawDistance = getDistance(pos, enemyPos);
    const dist = rawDistance - enemyRadius - unitRadius;

    const extraRange = sightRange * extraRangeFactor; // calculate extra range as a percentage of sightRange

    if (dist < sightRange + extraRange) {
      acc.push({
        unit: enemyUnit,
        dist: dist
      });
    }
    return acc;
  }, []);
};

/**
 * Rotates around the original position by the given angle and tries to find a pathable point.
 * 
 * @param {MapResource} map
 * @param {Point2D} targetPos
 * @param {Point2D} originalPos
 * @param {number} rotationAngle
 * @param {number} distance
 * @returns {Point2D | undefined}
 */
function rotateAndFindPathablePoint(map, targetPos, originalPos, rotationAngle, distance) {
  // Check for undefined positions
  if (!targetPos || !targetPos.x || !targetPos.y || !originalPos || !originalPos.x || !originalPos.y) return undefined;

  // Calculate the original angle
  const originalAngle = toDegrees(Math.atan2(targetPos.y - originalPos.y, targetPos.x - originalPos.x));

  // Adjust by the rotation angle
  const rotatedAngle = (originalAngle + rotationAngle) % 360;

  // Calculate the new point
  let rotatedPoint = {
    x: Math.cos(rotatedAngle * Math.PI / 180) * distance + originalPos.x,
    y: Math.sin(rotatedAngle * Math.PI / 180) * distance + originalPos.y
  };

  // Check if the new point is pathable
  if (map.isPathable(rotatedPoint)) {
    return rotatedPoint;
  } else {
    return undefined;
  }
}

/**
 * Calculate a position based on direction and max distance.
 * @param {Point2D} start
 * @param {Point2D} end
 * @param {number} maxDistance
 * @returns {Point2D | null}
 */
function calculatePositionByDirection(start, end, maxDistance) {
  if (!start.x || !start.y || !end.x || !end.y) return null;

  const direction = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.sqrt(direction.x ** 2 + direction.y ** 2);

  if (length <= maxDistance) return end;

  const normalizedDirection = { x: direction.x / length, y: direction.y / length };
  return {
    x: start.x + normalizedDirection.x * maxDistance,
    y: start.y + normalizedDirection.y * maxDistance
  };
}


