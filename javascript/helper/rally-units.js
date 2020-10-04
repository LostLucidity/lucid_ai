//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
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
      if (map.getNatural().getWall()) {
        rallyPoint = map.getCombatRally();
      }
    }
    const supportUnits = [];
    supportUnitTypes.forEach(type => {
      supportUnits.concat(units.getById(type).filter(unit => !unit.labels.get('scout')));
    });    
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
  collectedActions.push(...tankBehavior(resources, rallyPoint));
  return collectedActions;
}

module.exports = rallyUnits;