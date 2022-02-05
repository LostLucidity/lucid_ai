//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getDPSOfInRangeAntiAirUnits } = require("../helper/battle-analysis");
const { getClosestPosition } = require("../helper/get-closest");
const { existsInMap } = require("../helper/location");
const { moveAwayPosition } = require("../services/position-service");
const { retreatToExpansion } = require("../services/resource-manager-service");
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
   * 
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
      if (closestThreatUnit) {
        if (closestToNaturalBehavior(resources, shadowingUnits, unit, closestThreatUnit)) { return }
        if (distance(unit.pos, closestThreatUnit.pos) > closestThreatUnit.data().sightRange + unit.radius + closestThreatUnit.radius) {
          collectedActions.push(moveToTarget(unit, closestThreatUnit));
        } else {
          collectedActions.push(moveAwayFromTarget(world, unit, closestThreatUnit, enemyUnits));
        }
      } else if (closestInRangeUnit) {
        if (closestToNaturalBehavior(resources, shadowingUnits, unit, closestInRangeUnit)) { return }
        if (inRangeUnits.every(inRangeUnit => distance(unit.pos, inRangeUnit.pos) > inRangeUnit.data().sightRange)) {
          collectedActions.push(moveToTarget(unit, closestInRangeUnit));
        } else {
          collectedActions.push(moveAwayFromTarget(world, unit, closestInRangeUnit, enemyUnits))
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
  const { data, resources } = world;
  const { map, units } = resources.get();
  const isFlying = unit.isFlying;
  let position;
  if (isFlying) {
    const sightRange = unit.data().sightRange;
    const highPointCandidates = gridsInCircle(unit.pos, sightRange)
      .filter(grid => {
        if (existsInMap(map, grid)) {
          // get list of inrange enemy units
          const unitsInSightRangeTo = targetUnits.filter(targetUnit => {
            return distance(targetUnit.pos, unit.pos) < targetUnit.data().sightRange + unit.radius + targetUnit.radius;
          });
          try {
            const gridHeight = map.getHeight(grid);
            const circleCandidates = gridsInCircle(grid, unit.radius).filter(candidate => existsInMap(map, candidate) && distance(candidate, grid) <= unit.radius);
            const targetUnitHeight = Math.round(targetUnit.pos.z);
            const unitsInSightRangeToHeights = unitsInSightRangeTo.map(unit => Math.round(unit.pos.z));
            return (
              [
                gridHeight - targetUnitHeight >= 2,
                unitsInSightRangeToHeights.every(height => gridHeight - height >= 2),
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
      const dPSOfInRangeUnits = getDPSOfInRangeAntiAirUnits(data, targetUnit);
      const timeToBeKilled = (unit.health + unit.shield) / dPSOfInRangeUnits;
      const distanceToHighPoint = distance(unit.pos, closestHighPoint);
      const speed = unit.data().movementSpeed;
      const timeToTarget = distanceToHighPoint / speed;
      if (timeToBeKilled > timeToTarget) {
        position = closestHighPoint;
      }
    }
    position = position ? position : moveAwayPosition(targetUnit.pos, unit.pos);
  } else {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    targetUnit['inRangeUnits'] = enemyUnits.filter(enemyUnit => distance(targetUnit.pos, enemyUnit.pos) < 8);
    position = retreatToExpansion(world, unit, targetUnit);
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