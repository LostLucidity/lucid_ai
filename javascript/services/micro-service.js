//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");

const microService = {
  microRangedUnit: (unit, targetUnit) => {
    const collectedActions = [];
    if (unit.weaponCooldown > 12) {
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: targetUnit.pos,
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