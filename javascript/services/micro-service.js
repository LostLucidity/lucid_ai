//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { gridsInCircle, toDegrees } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { moveAwayPosition } = require("../builds/helper");
const { getClosestPosition } = require("../helper/get-closest");

const microService = {
  getPositionVersusTargetUnit: (data, unit, targetUnit) => {
    const totalRadius = unit.radius + targetUnit.radius + 1;
    const range = Math.max.apply(Math, data.getUnitTypeData(unit.unitType).weapons.map(weapon => { return weapon.range; })) + totalRadius;
    if (distance(unit.pos, targetUnit.pos) < range) {
      return moveAwayPosition(targetUnit, unit);
    } else {
      return targetUnit.pos;
    }
  },
  isFacing: (unit, targetUnit) => {
    const targetFacingDegrees = toDegrees(targetUnit.facing);
    const positionOfUnitDegrees = toDegrees(Math.atan2(unit.pos.y - targetUnit.pos.y, unit.pos.x - targetUnit.pos.x));
    const normalizedPositionOfUnitDegrees = positionOfUnitDegrees > 0 ? positionOfUnitDegrees : 360 + positionOfUnitDegrees;
    return Math.abs(targetFacingDegrees - normalizedPositionOfUnitDegrees) < 7;
  },
  microRangedUnit: ({ data, resources }, unit, targetUnit) => {
    const collectedActions = [];
    if (unit.weaponCooldown > 12) {
      const microPosition = microService.getPositionVersusTargetUnit(data, unit, targetUnit)
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: microPosition,
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