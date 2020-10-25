//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK, LOAD_BUNKER, SMART } = require("@node-sc2/core/constants/ability");
const { BUNKER } = require("@node-sc2/core/constants/unit-type");
const { getRallyPointByBases } = require("./location");
const { tankBehavior } = require("./unit-behavior");

function rallyUnits(resources, supportUnitTypes, rallyPoint=null) {
  const {
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const combatUnits = units.getCombatUnits().filter(unit => !unit.labels.get('harasser') && !unit.labels.get('scout'));
  if (combatUnits.length > 0) {
    if (!rallyPoint) {
      rallyPoint = map.getNatural() && map.getNatural().getWall() ? map.getCombatRally() : getRallyPointByBases(map, units);
    }
    const supportUnits = [];
    supportUnitTypes.forEach(type => {
      supportUnits.concat(units.getById(type).filter(unit => !unit.labels.get('scout')));
    });
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
          unitTags: combatUnits.map(unit => unit.tag),
        }
        collectedActions.push(unitCommand);
      }
      if (supportUnits.length > 0) {
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: rallyPoint,
          unitTags: supportUnits.map(unit => unit.tag),
        }
        collectedActions.push(unitCommand);
      }
    } else {
      const unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: rallyPoint,
        unitTags: combatUnits.map(unit => unit.tag),
      }
      collectedActions.push(unitCommand);
      if (supportUnits.length > 0) {
        const unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: rallyPoint,
          unitTags: supportUnits.map(unit => unit.tag),
        }
        collectedActions.push(unitCommand);
      }
    }
  }
  collectedActions.push(...tankBehavior(units));
  return collectedActions;
}

module.exports = rallyUnits;