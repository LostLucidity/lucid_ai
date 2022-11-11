//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { OVERLORD, COLOSSUS } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { getInRangeUnits } = require("../helper/battle-analysis");
const { getClosestPosition } = require("../helper/get-closest");
const { existsInMap } = require("../helper/location");
const { getTimeInSeconds } = require("../services/frames-service");
const { moveAwayPosition, getDistance } = require("../services/position-service");
const { getMovementSpeed } = require("../services/unit-service");
const { retreat, getDPSOfInRangeAntiAirUnits } = require("../services/world-service");
const { isWorker } = require("../systems/unit-resource/unit-resource-service");

const helper = {
  /**
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} distance 
   * @returns 
   */
  moveAway(unit, targetUnit, distance = 2) {
    const awayPoint = moveAwayPosition(targetUnit.pos, unit.pos, distance);
    const unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: awayPoint,
      unitTags: [unit.tag]
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
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    shadowingUnits.forEach(unit => {
      const inRangeUnits = enemyUnits.filter(enemyUnit => distance(unit.pos, enemyUnit.pos) < unit.data().sightRange);
      const [closestInRangeUnit] = units.getClosest(unit.pos, inRangeUnits);
      const [closestThreatUnit] = inRangeUnits.filter(inRangeUnit => inRangeUnit.canShootUp()).sort((a, b) => {
        const weaponsAirRangeA = Math.max.apply(Math, data.getUnitTypeData(a.unitType).weapons.map(weapon => { return weapon.range; }));
        const distanceToRangeA = distance(a.pos, unit.pos) - weaponsAirRangeA;
        const weaponsAirRangeB = Math.max.apply(Math, data.getUnitTypeData(b.unitType).weapons.map(weapon => { return weapon.range; }));
        const distanceToRangeB = distance(b.pos, unit.pos) - weaponsAirRangeB;
        return distanceToRangeA - distanceToRangeB;
      });
      const unitToShadow = closestThreatUnit || closestInRangeUnit || null;
      const shouldShadow = unitToShadow && checkIfShouldShadow(resources, unit, shadowingUnits, unitToShadow);
      if (shouldShadow) { 
        if (closestThreatUnit) {
          if (distance(unit.pos, closestThreatUnit.pos) > closestThreatUnit.data().sightRange + unit.radius + closestThreatUnit.radius) {
            collectedActions.push(moveToTarget(unit, closestThreatUnit));
          } else {
            collectedActions.push(moveAwayFromTarget(world, unit, closestThreatUnit, getInRangeUnits(unit, enemyUnits, 16)));
          }
        } else if (closestInRangeUnit) {
          if (closestToNaturalBehavior(resources, shadowingUnits, unit, closestInRangeUnit)) { return }
          if (inRangeUnits.every(inRangeUnit => distance(unit.pos, inRangeUnit.pos) > inRangeUnit.data().sightRange)) {
            collectedActions.push(moveToTarget(unit, closestInRangeUnit));
          } else {
            collectedActions.push(moveAwayFromTarget(world, unit, closestInRangeUnit, enemyUnits))
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
 * @param {Unit} targetUnit 
 * @param {Unit[]} targetUnits 
 * @returns {SC2APIProtocol.ActionRawUnitCommand}
 */
function moveAwayFromTarget(world, unit, targetUnit, targetUnits) {
  const { resources } = world;
  const { map, units } = resources.get();
  const isFlying = unit.isFlying;
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
          const targetUnitHeight = Math.round(targetUnit.pos.z);
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
    const averageEnemyPos = avgPoints(targetUnits.map(unit => unit.pos));
    position = position ? position : moveAwayPosition(averageEnemyPos, unit.pos);
  } else {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    targetUnit['inRangeUnits'] = enemyUnits.filter(enemyUnit => distance(targetUnit.pos, enemyUnit.pos) < 8);
    position = retreat(world, unit, targetUnit);
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
 * @param {Unit} closestThreatUnit
 * @returns {boolean}
 */
function checkIfShouldShadow(resources, unit, shadowingUnits, closestThreatUnit) {
  const { frame, map, units } = resources.get();
  const { centroid } = map.getEnemyNatural(); if (centroid === undefined) return false;
  const [closestToEnemyNatural] = units.getClosest(centroid, shadowingUnits);
  const isClosestToEnemyNatural = closestToEnemyNatural && unit.tag === closestToEnemyNatural.tag;
  const { pos } = closestThreatUnit; if (pos === undefined) return false;
  const outOfNaturalRangeWorker = isWorker(closestThreatUnit) && getDistance(pos, centroid) > 16;
  const isGameTimeLaterThanTargetTime = getTimeInSeconds(frame.getGameLoop()) >= 131;
  const shouldClosestToEnemyNaturalShadow = isClosestToEnemyNatural && isGameTimeLaterThanTargetTime && [outOfNaturalRangeWorker, !isWorker(closestThreatUnit)].some(condition => condition);
  const conditions = [
    shouldClosestToEnemyNaturalShadow,
    !isClosestToEnemyNatural,
  ];
  return conditions.some(condition => condition);
}
