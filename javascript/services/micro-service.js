//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { gridsInCircle, toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getClosestPosition } = require("../helper/get-closest");

const microService = {
  isFacing: (unit, targetUnit) => {
    const targetFacingDegrees = toDegrees(targetUnit.facing);
    const positionOfUnitDegrees = toDegrees(Math.atan2(unit.pos.y - targetUnit.pos.y, unit.pos.x - targetUnit.pos.x));
    const normalizedPositionOfUnitDegrees = positionOfUnitDegrees > 0 ? positionOfUnitDegrees : 360 + positionOfUnitDegrees;
    return Math.abs(targetFacingDegrees - normalizedPositionOfUnitDegrees) < 7;
  },
  microRangedUnit: ({ data, resources }, unit, targetUnit) => {
    const collectedActions = [];
    if (unit.weaponCooldown > 12) {
      const totalRadius = unit.radius + targetUnit.radius + 1;
      const range = Math.max.apply(Math, data.getUnitTypeData(unit.unitType).weapons.map(weapon => { return weapon.range; })) + totalRadius;
      const enemyRange = Math.max.apply(Math, data.getUnitTypeData(targetUnit.unitType).weapons.map(weapon => { return weapon.range; })) + totalRadius;
      const gridCandidates = gridsInCircle(targetUnit.pos, range)
        .filter(grid => {
          return [
            distance(grid, targetUnit.pos) <= range,
            distance(grid, targetUnit.pos) >= enemyRange,
            grid.y >= 1 && resources.get().map.isPathable(grid),  
          ].every(condition => condition);
        });
      const [closestPosition] = getClosestPosition(unit.pos, gridCandidates);
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: closestPosition || targetUnit.pos,
        unitTags: [unit.tag],
      });
    } else {
      collectedActions.push({
        abilityId: ATTACK_ATTACK,
        targetUnitTag: targetUnit.tag,
        unitTags: [unit.tag],
      });
    }
    return collectedActions;
  }
}

module.exports = microService;