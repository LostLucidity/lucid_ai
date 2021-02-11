//@ts-check
"use strict"

const { EFFECT_SCAN } = require("@node-sc2/core/constants/ability");
const { ORBITALCOMMAND } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");

module.exports = {
  scanCloakedEnemy: (units, target, selfUnits) => {
    const collectedActions = []
    if (target.cloak === 1) {
      let position = null;
      if (target.cloak === 1) {
        const [ closestToCloak ] = units.getClosest(target.pos, selfUnits);
        if (distance(closestToCloak.pos, target.pos) < 8) {
          position = target.pos;
        }
        const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
        if (position && orbitalCommand) {
          const unitCommand = {
            abilityId: EFFECT_SCAN,
            targetWorldSpacePos: position,
            unitTags: [ orbitalCommand.tag ],
          }
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  }
}