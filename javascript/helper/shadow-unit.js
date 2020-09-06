//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");
const { MOVE } = require("@node-sc2/core/constants/ability");
const { toDegrees } = require("@node-sc2/core/utils/geometry/angle");

function shadowUnit(unit, enemyUnit) {
  const collectedActions = [];
  const distanceToEnemy = distance(unit.pos, enemyUnit.pos);
  const observerSightRange = unit.data().sightRange;
  const enemySightRange = enemyUnit.data().sightRange;
  const averageSightRange = (observerSightRange + enemySightRange) / 2;
  if (distanceToEnemy < observerSightRange && distanceToEnemy > averageSightRange) {
    const totalHealthShield = unit.health + unit.shield;
    const maxHealthShield = unit.healthMax + unit.shieldMax;
    if (totalHealthShield / maxHealthShield > 0.5) {
      // move towards
      const unitCommand = {
        abilityId: MOVE,
        targetUnitTag: enemyUnit.tag,
        unitTags: [ unit.tag ]
      }
      collectedActions.push(unitCommand);
    }
  } else if (distanceToEnemy < enemySightRange) {
    // move away
    // angle of enemy in grid.
    const angle = toDegrees(Math.atan2(enemyUnit.pos.y - unit.pos.y, enemyUnit.pos.x - unit.pos.x));
    const oppositeAngle = angle + 180 % 360;
    const awayPoint = {
      x: Math.cos(oppositeAngle * Math.PI / 180) * 2 + unit.pos.x,
      y: Math.sin(oppositeAngle * Math.PI / 180) * 2 + unit.pos.y
    }
    // Get opposite angle of enemy.
    // move to point with opposite angle and distance
    const unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: awayPoint,
      unitTags: [ unit.tag ]
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

module.exports = shadowUnit;