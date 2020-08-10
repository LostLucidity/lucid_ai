//@ts-check
"use strict"

const { distance } = require("@node-sc2/core/utils/geometry/point");

const { LOAD_BUNKER, MOVE, ATTACK_ATTACK, SMART } = require("@node-sc2/core/constants/ability");
const { BUNKER } = require("@node-sc2/core/constants/unit-type");

function rallyUnits(resources, supportUnitTypes) {
  const {
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const combatUnits = units.getCombatUnits();
  if (combatUnits.length > 0) {
    let rallyPoint = map.getCombatRally();
    const supportUnits = [];
    supportUnitTypes.forEach(type => {
      supportUnits.concat(units.getById(type));
    })
    if (units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1).length > 0) {
      const [ bunker ] = units.getById(BUNKER);
      rallyPoint = bunker.pos;
      const closestCombatUnitTags = units.getClosest(bunker.pos, combatUnits, combatUnits.length, bunker.cargoSpaceMax - bunker.cargoSpaceTaken).map(unit => unit.tag);
      if (bunker.abilityAvailable(LOAD_BUNKER)) {
        const unitCommand = {
          abilityId: SMART,
          targetUnitTag: bunker.tag,
          unitTags: closestCombatUnitTags,
        }
        collectedActions.push(unitCommand);
      } else {
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: rallyPoint,
          unitTags: combatUnits.map(unit => unit.tag)
        }
        collectedActions.push(unitCommand);
      }
      if (supportUnits.length > 0) {
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: rallyPoint,
          unitTags: supportUnits.map(unit => unit.tag)
        }
        collectedActions.push(unitCommand);
      }
    } else {
      const unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: rallyPoint,
        unitTags: combatUnits.map(unit => unit.tag)
      }
      collectedActions.push(unitCommand);
      if (supportUnits.length > 0) {
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: rallyPoint,
          unitTags: supportUnits.map(unit => unit.tag)
        }
        collectedActions.push(unitCommand);
      }
    }
  }
  return collectedActions;
}

module.exports = rallyUnits;