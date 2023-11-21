//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { OVERLORD, COLOSSUS } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle, toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");
const { existsInMap } = require("../helper/location");
const { getTimeInSeconds, getTravelDistancePerStep } = require("../services/frames-service");
const { moveAwayPosition } = require("../services/position-service");
const { canAttack } = require("../services/resources-service");
const { isWorker } = require("../systems/unit-resource/unit-resource-service");
const { createUnitCommand } = require("../src/utils");
// Retrieve the armyManagementService using the service locator's get method

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

      const extraRangeFactor = armyManagementService.outpowered ? 0.1 : 0; // increase by 10% if outpowered
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
    position = getFlyingUnitPosition(world, unit) ||
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
 * Returns the best position for the flying unit to move to, considering the unit's health, shield,
 * and position as well as the positions of enemies and terrain. If no suitable position is found,
 * it returns undefined.
 *
 * @param {World} world - The current state of the world, including all units and terrain.
 * @param {Unit} unit - The flying unit that is looking for the best position to move to.
 * @returns {Point2D | undefined} - The best position for the flying unit to move to, or undefined if no suitable position is found.
 */
function getFlyingUnitPosition(world, unit) {
  const { resources } = world;
  const { map } = resources.get();
  const { health, shield, pos } = unit;

  // Corrected the condition to check for undefined explicitly
  if (health === undefined || shield === undefined || pos === undefined) return;

  const elevatedPositions = getHiddenElevatedPositions(world, unit);

  if (elevatedPositions.length === 0) return;

  const [closestHighPoint] = getClosestPosition(pos, elevatedPositions);
  if (!closestHighPoint) return;

  const distanceToHighPoint = getDistance(pos, closestHighPoint);
  const speed = getMovementSpeed(map, unit, true);
  if (!speed) return;

  const timeToTarget = distanceToHighPoint / speed;
  const dPSOfInRangeUnits = getDPSOfInRangeAntiAirUnits(world, unit);
  const timeToBeKilled = (health + shield) / dPSOfInRangeUnits;

  return timeToBeKilled > timeToTarget ? closestHighPoint : undefined;
}
/**
 * Returns a list of high point grid positions that are hidden and safe for the flying unit to move to.
 * The function first filters out enemy units based on their sight range and distance from the flying unit.
 * Then, it identifies the highest enemy unit and filters out grid positions based on their height, visibility, 
 * and whether adjacent grids are higher or not.
 *
 * @param {World} world - The world containing information about the terrain and positions.
 * @param {Unit} unit - The flying unit looking for hidden elevated positions.
 * @returns {Point2D[]} - An array of hidden elevated positions.
 */
function getHiddenElevatedPositions(world, unit) {
  const { resources } = world;
  const { map } = resources.get();

  const { pos, radius } = unit;
  const unitData = unit.data();
  const { sightRange } = unitData;

  // Validate essential parameters
  if (!pos || !radius || !sightRange || !unitData) return [];

  // Filter target units based on their sight range and distance to the flying unit
  const targetUnits = enemyTrackingService.mappedEnemyUnits.filter(enemy => {
    const enemyData = enemy.data();
    return enemy.pos &&
      enemyData &&
      enemyData.sightRange &&
      getDistance(enemy.pos, pos) < enemyData.sightRange + sightRange;
  });

  // Calculate the highest height among all target units
  const highestTargetHeight = Math.max(...targetUnits.map(targetUnit => {
    const { pos: targetPos } = targetUnit;
    if (!targetPos) return 0;
    return targetPos.z !== undefined ? Math.round(targetPos.z) : 0;
  }));

  // Filter potential hidden elevated positions based on criteria
  return gridsInCircle(pos, Math.ceil(sightRange * 1.2)).filter(grid => {
    if (!existsInMap(map, grid)) return false;

    const gridHeight = map.getHeight(grid);
    if (gridHeight < highestTargetHeight + 2) return false;

    return !isPositionVisibleToAnyUnit(grid, targetUnits, radius, gridHeight) &&
      areAllAdjacentGridsHigher(map, grid, radius, gridHeight);
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
/**
 * Checks if the given position is visible to any of the provided units.
 *
 * @param {Point2D} position - The position to check for visibility.
 * @param {Unit[]} units - The units to check for visibility against.
 * @param {number} radius - The radius of the flying unit.
 * @param {number} height - The height of the grid position.
 * @returns {boolean} - True if the position is visible to any unit, false otherwise.
 */
function isPositionVisibleToAnyUnit(position, units, radius, height) {
  return units.some(unit => {
    const { pos: unitPos, radius: unitRadius } = unit;
    const unitData = unit.data();
    const { sightRange } = unitData;
    const unitHeight = unitPos?.z;

    if (!unitPos || !unitRadius || !sightRange || unitHeight === undefined || !unitData) return false;

    const inSightRange = getDistance(unitPos, position) < sightRange + radius + unitRadius;
    const canSeeUp = unit.isFlying || unit.unitType === COLOSSUS || Math.round(unitHeight) + 2 > height;

    return inSightRange && canSeeUp;
  });
}
/**
 * Checks if all adjacent grids are higher or equal in height.
 *
 * @param {MapResource} map - The map resource containing information about the terrain and positions.
 * @param {Point2D} position - The central position around which to check the adjacent grids.
 * @param {number} radius - The radius around the position to check.
 * @param {number} height - The height to compare against.
 * @returns {boolean} - True if all adjacent grids are higher or equal in height, false otherwise.
 */
function areAllAdjacentGridsHigher(map, position, radius, height) {
  return gridsInCircle(position, radius).every(candidate =>
    existsInMap(map, candidate) && map.getHeight(candidate) >= height);
}