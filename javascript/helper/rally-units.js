//@ts-check
"use strict"

const { MOVE, LOAD_BUNKER, SMART } = require("@node-sc2/core/constants/ability");
const { BUNKER, LARVA } = require("@node-sc2/core/constants/unit-type");
const { engageOrRetreat } = require("./army-behavior");
const { getCombatRally } = require("./location");
const { tankBehavior } = require("./unit-behavior");
const { Alliance } = require("@node-sc2/core/constants/enums");

function rallyUnits({ data, resources }, supportUnitTypes, rallyPoint=null) {
  const {
    map,
    units,
  } = resources.get();
  const collectedActions = [];
  const combatUnits = units.getCombatUnits().filter(unit => !unit.labels.get('harasser') && !unit.labels.get('scout'));
  if (combatUnits.length > 0) {
    if (!rallyPoint) {
      rallyPoint = getCombatRally(map, units);
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
      const selfUnits = [...combatUnits, ...supportUnits];
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
      collectedActions.push(...engageOrRetreat({ data, resources }, units, selfUnits, enemyUnits, rallyPoint))
    }
  }
  collectedActions.push(...tankBehavior(units));
  return collectedActions;
}

module.exports = rallyUnits;