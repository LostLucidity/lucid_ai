//@ts-check
"use strict"

const Ability = require("@node-sc2/core/constants/ability");
const { EFFECT_SCAN, CANCEL_QUEUECANCELTOSELECTION } = require("@node-sc2/core/constants/ability");
const { liftingAbilities, landingAbilities, townhallTypes, rallyWorkersAbilities } = require("@node-sc2/core/constants/groups");
const { ORBITALCOMMAND } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getAvailableExpansions } = require("./expansions");
const { getClosest } = require("./get-closest");

module.exports = {
  liftToThird: async (resources) => {
    const { actions, map, units } = resources.get();
    const label = 'liftToThird';
    let [liftToThird] = units.withLabel(label);
    if (!liftToThird) {
      [ liftToThird ] = units.getById(townhallTypes).filter(base => {
        const [closestTownhallPosition] = getClosest(base.pos, map.getExpansions().map(expansion => expansion.townhallPosition));
        return distance(base.pos, closestTownhallPosition) > 1 || base.isFlying;
      })
      if (liftToThird) {
        liftToThird.labels.set('liftToThird');
      }
    } else {
      const [ position ] = getAvailableExpansions(resources).map(expansion => ({ expansion, distance: distance(liftToThird.pos, expansion.townhallPosition) }))
        .sort((a, b) => a.distance - b.distance)
        .map(u => u.expansion.townhallPosition)
        .slice(0, 1);
      if (position) {
        const [closestTownhallPosition] = getClosest(liftToThird.pos, map.getExpansions().map(expansion => expansion.townhallPosition));
        const rallyAbility = rallyWorkersAbilities.find(ability => liftToThird.abilityAvailable(ability));
        if (distance(liftToThird.pos, closestTownhallPosition) < 1 && rallyAbility) {
          liftToThird.labels.clear();
          const [mineralFieldTarget] = units.getClosest(liftToThird.pos, units.getMineralFields());
          await actions.sendAction({
              abilityId: rallyAbility,
              targetUnitTag: mineralFieldTarget.tag,
              unitTags: [liftToThird.tag]
          });
        } else {
          if (liftToThird.noQueue) {
            if (liftToThird.abilityAvailable(CANCEL_QUEUECANCELTOSELECTION)) {
              const unitCommand = {
                abilityId: CANCEL_QUEUECANCELTOSELECTION,
                unitTags: [ liftToThird.tag ],
              }
              await actions.sendAction(unitCommand);
            }
            if (liftToThird.availableAbilities().find(ability => liftingAbilities.includes(ability))) { await actions.do(Ability.LIFT, liftToThird.tag); }
            if (liftToThird.availableAbilities().includes(Ability.MOVE)) { await actions.move([liftToThird], position, true); }
            if (liftToThird.availableAbilities().find(ability => landingAbilities.includes(ability))) { await actions.do(Ability.LAND, liftToThird.tag, { target: position, queue: true }); }
          }
        }
      }
    }

  },
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