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
    shadowingUnits.forEach(unit => {
      const inRangeUnits = enemyUnits.filter(enemyUnit => distance(unit.pos, enemyUnit.pos) < unit.data().sightRange);
      const [closestInRangeUnit] = units.getClosest(unit.pos, inRangeUnits);
      const inRangeThreateningUnits = inRangeUnits.filter(inRangeUnit => inRangeUnit.canShootUp()).sort((a, b) => {
        const weaponsAirRangeA = Math.max.apply(Math, data.getUnitTypeData(a.unitType).weapons.map(weapon => { return weapon.range; }));
        const distanceToRangeA = distance(a.pos, unit.pos) - weaponsAirRangeA;
        const weaponsAirRangeB = Math.max.apply(Math, data.getUnitTypeData(b.unitType).weapons.map(weapon => { return weapon.range; }));
        const distanceToRangeB = distance(b.pos, unit.pos) - weaponsAirRangeB;
        return distanceToRangeA - distanceToRangeB;
      });
      const [closestThreatUnit] = inRangeThreateningUnits;
      const unitToShadow = closestThreatUnit || closestInRangeUnit || null;
      const shouldShadow = unitToShadow && checkIfShouldShadow(resources, unit, shadowingUnits, unitToShadow);
      if (shouldShadow) { 
        if (inRangeThreateningUnits.length > 0) {
          // get closest threatening unit by weapon range
          if (distance(unit.pos, closestThreatUnit.pos) > closestThreatUnit.data().sightRange + unit.radius + closestThreatUnit.radius) {
            collectedActions.push(moveToTarget(unit, closestThreatUnit));
          } else {
            collectedActions.push(moveAwayFromTarget(world, unit, inRangeThreateningUnits));
          }
        } else if (closestInRangeUnit) {
          if (closestToNaturalBehavior(resources, shadowingUnits, unit, closestInRangeUnit)) { return }
          if (inRangeUnits.every(inRangeUnit => distance(unit.pos, inRangeUnit.pos) > inRangeUnit.data().sightRange)) {
            collectedActions.push(moveToTarget(unit, closestInRangeUnit));
          } else {
            collectedActions.push(moveAwayFromTarget(world, unit, enemyUnits))
          }
        }
      }
    });
    return collectedActions;
  }
}

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
  const { map, units } = resources.get();
  const { isFlying, pos } = unit; if (pos === undefined) { return null; }
  let position;
  if (isFlying) {
    const sightRange = unit.data().sightRange;
    const highPointCandidates = gridsInCircle(unit.pos, sightRange).filter(grid => {
      if (existsInMap(map, grid)) {
        const unitsInSightRangeTo = targetUnits.filter(targetUnit => {
          return distance(targetUnit.pos, grid) < targetUnit.data().sightRange + unit.radius + targetUnit.radius;
        });
        try {
          const gridHeight = map.getHeight(grid);
          const circleCandidates = gridsInCircle(grid, unit.radius).filter(candidate => existsInMap(map, candidate) && distance(candidate, grid) <= unit.radius);
          const targetUnitHeight = targetUnits.reduce((acc, targetUnit) => {
            const { pos } = targetUnit; if (pos === undefined) return acc;
            const { z } = pos; if (z === undefined) return acc;
            return Math.max(acc, Math.round(z));
          }, 0);
          const isVisibleToAnyTargetUnit = unitsInSightRangeTo.some(unitInSight => {
            const { pos } = unitInSight; if (pos === undefined) return true;
            const { z } = pos; if (z === undefined) return true;
            return unitInSight.isFlying || unitInSight.unitType === COLOSSUS || Math.round(z) + 2 > gridHeight;
          });
          return (
            [
              gridHeight - targetUnitHeight >= 2,
              !isVisibleToAnyTargetUnit,
              circleCandidates.every(adjacentGrid => map.getHeight(adjacentGrid) >= gridHeight),
            ].every(condition => condition)
          );
        } catch (error) {
          console.log('error', error);
          return false;
        }
      }
    });
    const [closestHighPoint] = getClosestPosition(unit.pos, highPointCandidates);
    // calculate dps of enemy versus distance and speed of overlord.
    if (closestHighPoint) {
      const dPSOfInRangeUnits = getDPSOfInRangeAntiAirUnits(world, unit);
      const timeToBeKilled = (unit.health + unit.shield) / dPSOfInRangeUnits;
      const distanceToHighPoint = distance(unit.pos, closestHighPoint);
      const speed = getMovementSpeed(unit);
      const timeToTarget = distanceToHighPoint / speed;
      if (timeToBeKilled > timeToTarget) {
        position = closestHighPoint;
      }
    }
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
    unitTags: [unit.tag],
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

module.exports = helper;

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
  const canBeAttacked = canAttack(resources, targetUnit, unit);
  const shouldClosestToEnemyNaturalShadow = (
    (canBeAttacked || isGameTimeLaterThanTargetTime) &&
    (inRangeOfNaturalWorker || !isWorker(targetUnit))
  );
  return shouldClosestToEnemyNaturalShadow;
}
