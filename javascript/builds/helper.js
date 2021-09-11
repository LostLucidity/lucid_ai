//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");
const { toDegrees, gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getDPSOfInRangeAntiAirUnits } = require("../helper/battle-analysis");
const { getClosestPosition } = require("../helper/get-closest");
const { distanceByPath, getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { existsInMap } = require("../helper/location");

const helper = {
  retreatToExpansion: (resources, unit, targetUnit) => {
    const { map } = resources.get();
    if (!unit.expansions) { unit.expansions = new Map(); }
    if (!targetUnit.expansions) { targetUnit.expansions = new Map(); }
    const candidateExpansionsCentroid = map.getExpansions().filter(expansion => {
      const centroidString = expansion.centroid.x.toString() + expansion.centroid.y.toString();
      if (!(centroidString in targetUnit.expansions)) {
        let [closestToExpansion] = getClosestUnitByPath(resources, expansion.centroid, targetUnit.selfUnits);
        targetUnit.expansions[centroidString] = {
          'closestToExpansion': closestToExpansion,
          'distanceByPath': distanceByPath(resources, closestToExpansion.pos, expansion.centroid),
        }
      }
      if (!(centroidString in unit.expansions)) {
        unit.expansions[centroidString] = {
          'distanceByPath': distanceByPath(resources, unit.pos, expansion.centroid),
        }
      }
      const distanceByPathToCentroid = unit.expansions[centroidString].distanceByPath;
      return distanceByPathToCentroid !== 500 && distanceByPathToCentroid <= targetUnit.expansions[centroidString].distanceByPath;
    }).map(expansion => expansion.centroid);
    const [largestPathDifferenceCentroid] = candidateExpansionsCentroid
      .sort((a, b) => (distanceByPath(resources, unit.pos, a) - distanceByPath(resources, targetUnit.pos, a)) - (distanceByPath(resources, unit.pos, b) - distanceByPath(resources, targetUnit.pos, b)))
      .filter(centroid => distanceByPath(resources, targetUnit.pos, centroid) > 16);
    return largestPathDifferenceCentroid ? largestPathDifferenceCentroid : module.exports.moveAwayPosition(targetUnit, unit);
  },
  moveAway(unit, targetUnit, distance = 2) {
    const awayPoint = module.exports.moveAwayPosition(targetUnit, unit, distance);
    const unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: awayPoint,
      unitTags: [unit.tag]
    }
    return unitCommand;
  },
  moveAwayPosition(targetUnit, unit, distance = 2) {
    const angle = toDegrees(Math.atan2(targetUnit.pos.y - unit.pos.y, targetUnit.pos.x - unit.pos.x));
    const oppositeAngle = angle + 180 % 360;
    const awayPoint = {
      x: Math.cos(oppositeAngle * Math.PI / 180) * distance + unit.pos.x,
      y: Math.sin(oppositeAngle * Math.PI / 180) * distance + unit.pos.y
    }
    return awayPoint;
  },
  shadowEnemy({ data, resources }, shadowingUnits) {
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
          collectedActions.push(moveAwayFromTarget({ data, resources }, unit, closestThreatUnit, enemyUnits));
        }
      } else if (closestInRangeUnit) {
        if (closestToNaturalBehavior(resources, shadowingUnits, unit, closestInRangeUnit)) { return }
        if (distance(unit.pos, closestInRangeUnit.pos) > closestInRangeUnit.data().sightRange) {
          collectedActions.push(moveToTarget(unit, closestInRangeUnit));
        } else {
          collectedActions.push(moveAwayFromTarget({ data, resources }, unit, closestInRangeUnit, enemyUnits))
        }
      }
    });
    return collectedActions;
  }
}

function closestToNaturalBehavior(resources, shadowingUnits, unit, targetUnit) {
  const { map, units } = resources.get();
  const [closestToEnemyNatural] = units.getClosest(map.getEnemyNatural().centroid, shadowingUnits);
  if (map.getEnemyNatural()) {
    if (
      unit.tag === closestToEnemyNatural.tag &&
      workerTypes.includes(targetUnit.unitType) || targetUnit.unitType === OVERLORD
    ) { return true; }
  }
}

function moveAwayFromTarget({ data, resources }, unit, targetUnit, targetUnits) {
  const { map, units } = resources.get();
  const isFlying = unit.isFlying;
  let position;
  if (isFlying) {
    const sightRange = unit.data().sightRange;
    const highPoints = gridsInCircle(unit.pos, sightRange)
      .filter(grid => {
        if (existsInMap(map, grid)) {
          const [closestEnemyToPoint] = units.getClosest(grid, targetUnits);
          try {
            const gridHeight = map.getHeight(grid);
            const circleCandidates = gridsInCircle(grid, unit.radius).filter(candidate => distance(candidate, grid) <= unit.radius);
            const targetUnitHeight = targetUnit.isFlying ? targetUnit.pos.z : map.getHeight(targetUnit.pos);
            const closestEnemyToPointHeight = closestEnemyToPoint.isFlying ? closestEnemyToPoint.pos.z : map.getHeight(closestEnemyToPoint.pos);
            return (
              gridHeight - targetUnitHeight >= 2 &&
              gridHeight - closestEnemyToPointHeight >= 2 &&
              circleCandidates.every(adjacentGrid => map.getHeight(adjacentGrid) >= gridHeight)
            );
          } catch (error) {
            console.log('error', error);
            return false;
          }
        }
      });
    const [closestHighPoint] = getClosestPosition(unit.pos, highPoints);
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
    position = position ? position : helper.moveAwayPosition(targetUnit, unit);
  } else {
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    targetUnit.inRangeUnits = enemyUnits.filter(enemyUnit => distance(targetUnit.pos, enemyUnit.pos) < 8);
    position = helper.retreatToExpansion(resources, unit, targetUnit);
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