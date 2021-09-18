//@ts-check
"use strict"

const { BUNKER, LARVA, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { engageOrRetreat } = require("./behavior/army-behavior");
const { getCombatRally } = require("./location");
const { tankBehavior } = require("./behavior/unit-behavior");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");

function rallyUnits({ data, resources }, supportUnitTypes, rallyPoint = null) {
  const { units } = resources.get();
  const collectedActions = [];
  const combatUnits = units.getCombatUnits().filter(unit => unit.labels.size === 0);
  if (!rallyPoint) {
    rallyPoint = getCombatRally(resources);
  }
  if (combatUnits.length > 0) {
    const supportUnits = [];
    supportUnitTypes.forEach(type => {
      supportUnits.concat(units.getById(type).filter(unit => unit.labels.size === 0));
    });
    if (units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1).length > 0) {
      const [bunker] = units.getById(BUNKER);
      rallyPoint = bunker.pos;
    }
    const selfUnits = [...combatUnits, ...supportUnits, ...units.getById(QUEEN)];
    const enemyUnits = enemyTrackingService.mappedEnemyUnits.filter(unit => !(unit.unitType === LARVA));
    collectedActions.push(...engageOrRetreat({ data, resources }, selfUnits, enemyUnits, rallyPoint));
  }
  collectedActions.push(...tankBehavior(units, rallyPoint));
  return collectedActions;
}

module.exports = rallyUnits;