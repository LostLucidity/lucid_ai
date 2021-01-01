//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getClosestUnitByPath, distanceByPath } = require("../helper/get-closest-by-path");

module.exports = {
  mineralPosition: (resources, unit, targetUnit) => {
    const { units, map } = resources.get();
    const candidateMineralFields = units.getMineralFields().filter(field => distanceByPath(map, field.pos, unit.pos) < distanceByPath(map, field.pos, targetUnit.pos))
    const [ closestMineralFieldByPath ] = getClosestUnitByPath(map, unit.pos, candidateMineralFields, candidateMineralFields.length).filter(field => distanceByPath(map, field.pos, targetUnit.pos) > 16);
    return closestMineralFieldByPath ? closestMineralFieldByPath.pos : module.exports.moveAwayPosition(targetUnit, unit);
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
            position = module.exports.mineralPosition(resources, scoutingUnit, closestEnemy);
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
