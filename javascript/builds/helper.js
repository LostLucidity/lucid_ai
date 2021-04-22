//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { distanceByPath, getClosestPositionByPath, getClosestUnitByPath } = require("../helper/get-closest-by-path");

module.exports = {
  retreatToExpansion: (resources, unit, targetUnit) => {
    const { map } = resources.get();
    if (!unit.expansions) { unit.expansions = new Map(); }
    if (!targetUnit.expansions) { targetUnit.expansions = new Map(); }
    const candidateExpansionsCentroid = map.getExpansions().filter(expansion => {
      const centroidString = expansion.centroid.x.toString() + expansion.centroid.y.toString();
      if (!(centroidString in targetUnit.expansions)) {
        let [ closestToExpansion ] = getClosestUnitByPath(resources, expansion.centroid, targetUnit.inRangeUnits);
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
      return unit.expansions[centroidString].distanceByPath < targetUnit.expansions[centroidString].distanceByPath;
    }).map(expansion => expansion.centroid);
    const [ closestExpansionCentroidByPath ] = getClosestPositionByPath(resources, unit.pos, candidateExpansionsCentroid, candidateExpansionsCentroid.length).filter(centroid => distanceByPath(resources, centroid, targetUnit.pos) > 16);
    return closestExpansionCentroidByPath ? closestExpansionCentroidByPath : module.exports.moveAwayPosition(targetUnit, unit);
  },
  moveAway(unit, targetUnit, distance=2) {
    const awayPoint = module.exports.moveAwayPosition(targetUnit, unit, distance);
    const unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: awayPoint,
      unitTags: [ unit.tag ]
    }
    return unitCommand;
  },
  moveAwayPosition(targetUnit, unit, distance=2) {
        // move away
    // angle of enemy in grid.
    const angle = toDegrees(Math.atan2(targetUnit.pos.y - unit.pos.y, targetUnit.pos.x - unit.pos.x));
    const oppositeAngle = angle + 180 % 360;
    const awayPoint = {
      x: Math.cos(oppositeAngle * Math.PI / 180) * distance + unit.pos.x,
      y: Math.sin(oppositeAngle * Math.PI / 180) * distance + unit.pos.y
    }
    // Get opposite angle of enemy.
    // move to point with opposite angle and distance
    return awayPoint;
  },
  shadowEnemy(resources, state, unitTypes) {
    const { map, units } = resources.get();
    const collectedActions = [];
    const scoutingUnits = [...units.getById(unitTypes), ...units.withLabel('scout')];
    scoutingUnits.forEach(scoutingUnit => {
      // follow drones outside of overlord of natural expansion scout
      const [ closestEnemy ] = units.getClosest(scoutingUnit.pos, units.getAlive(Alliance.ENEMY).filter(unit => {
        if (map.getEnemyNatural()) {
          const [ closestOverlordToEnemyNatural ] = units.getClosest(map.getEnemyNatural().centroid, scoutingUnits);
          if (scoutingUnit.tag === closestOverlordToEnemyNatural.tag) {
            return workerTypes.includes(unit.unitType) || unit.unitType === OVERLORD ? false : true;
          } else {
            // count enemy units outside their range
            detectRush(map, units, state);
            return true;
          }
        }
      }));
      if (closestEnemy && distance(scoutingUnit.pos, closestEnemy.pos) < 16) {
        const distanceToEnemy = distance(scoutingUnit.pos, closestEnemy.pos);
        const overlordSightRange = scoutingUnit.data().sightRange;
        const enemySightRange = closestEnemy.data().sightRange;
        const averageSightRange = (overlordSightRange + enemySightRange) / 2;
        // if (distanceToEnemy < overlordSightRange && distanceToEnemy > enemySightRange) {
        //   collectedActions.push(...holdPosition(overlord));
        // } else 
        if (distanceToEnemy < overlordSightRange && distanceToEnemy > averageSightRange) {
          if (scoutingUnit.health / scoutingUnit.healthMax > 0.5) {
            // move towards
            const unitCommand = {
              abilityId: MOVE,
              targetUnitTag: closestEnemy.tag,
              unitTags: [ scoutingUnit.tag ]
            }
            collectedActions.push(unitCommand);
          }
        } else if (distanceToEnemy - scoutingUnit.radius < enemySightRange + closestEnemy.radius) {
          const isFlying = scoutingUnit.isFlying;
          let position;
          if (isFlying) {
            position = module.exports.moveAwayPosition(closestEnemy, scoutingUnit);
          } else {
            const enemyUnits = units.getAlive(Alliance.ENEMY);
            closestEnemy.inRangeUnits = enemyUnits.filter(enemyUnit => distance(closestEnemy.pos, enemyUnit.pos) < 8);
            position = module.exports.retreatToExpansion(resources, scoutingUnit, closestEnemy);
          }
          const unitCommand = {
            abilityId: MOVE,
            targetWorldSpacePos: position,
            unitTags: [ scoutingUnit.tag ],
          }
          collectedActions.push(unitCommand);
        }
      }
    });
    return collectedActions;
  }
}

function detectRush(map, units, state) {
  // if enemy natural overlord is killed
  const enemyBases = units.getBases(Alliance.ENEMY);
  const threateningUnits = units.getAlive(Alliance.ENEMY).filter(unit => {
    if (enemyBases.length > 0) {
      const [ closestBase ] = units.getClosest(unit.pos, enemyBases);
      if (distance(unit.pos, closestBase.pos) > 22) {
        return true; 
      }
    } else {
      const enemyMain = map.getEnemyMain();
      if (distance(unit.pos, enemyMain.townhallPosition) > 22) {
        return true; 
      }
    }
  })
  if (threateningUnits.length > 1) {
    state.paused = true;
    state.rushDetected = true;
  } else {
    state.paused = false;
    state.rushDetected = false;
  }
}
