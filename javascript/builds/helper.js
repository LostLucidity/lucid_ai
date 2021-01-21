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
      if (!targetUnit.expansions.has(centroidString)) {
        let [ closestToExpansion ] = getClosestUnitByPath(resources, expansion.centroid, targetUnit.inRangeUnits);
        targetUnit.expansions.set(centroidString, {
          'closestToExpansion': closestToExpansion,
          'distanceByPath': distanceByPath(resources, closestToExpansion.pos, expansion.centroid),
        });
      }
      if (!unit.expansions.has(centroidString)) {
        unit.expansions.set(centroidString, {
          'distanceByPath': distanceByPath(resources, unit.pos, expansion.centroid),
        });
      }
      return unit.expansions.get(centroidString).distanceByPath < targetUnit.expansions.get(centroidString).distanceByPath;
    }).map(expansion => expansion.centroid);
    const [ closestExpansionCentroidByPath ] = getClosestPositionByPath(resources, unit.pos, candidateExpansionsCentroid, candidateExpansionsCentroid.length).filter(centroid => distanceByPath(resources, centroid, targetUnit.pos) > 16);
    return closestExpansionCentroidByPath ? closestExpansionCentroidByPath : module.exports.moveAwayPosition(targetUnit, unit);
  },
  moveAway(unit, targetUnit) {
    const awayPoint = module.exports.moveAwayPosition(targetUnit, unit);
    const unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: awayPoint,
      unitTags: [ unit.tag ]
    }
    return unitCommand;
  },
  moveAwayPosition(targetUnit, unit) {
        // move away
    // angle of enemy in grid.
    const angle = toDegrees(Math.atan2(targetUnit.pos.y - unit.pos.y, targetUnit.pos.x - unit.pos.x));
    const oppositeAngle = angle + 180 % 360;
    const awayPoint = {
      x: Math.cos(oppositeAngle * Math.PI / 180) * 2 + unit.pos.x,
      y: Math.sin(oppositeAngle * Math.PI / 180) * 2 + unit.pos.y
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
            return workerTypes.includes(unit.unitType) || unit.unitType === 106 ? false : true;
          } else {
            // count enemy units outside their range
            detectRush(map, units, state);
            return true;
          }
        }
      }));
      if (closestEnemy) {
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
        } else if (distanceToEnemy < enemySightRange) {
          const isFlying = scoutingUnit.isFlying;
          let position;
          if (isFlying) {
            position = module.exports.moveAwayPosition(closestEnemy, scoutingUnit);
          } else {
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
