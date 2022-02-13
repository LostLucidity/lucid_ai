//@ts-check
"use strict"

const { BUNKER, LARVA } = require("@node-sc2/core/constants/unit-type");
const { engageOrRetreat } = require("./behavior/army-behavior");
const { getCombatRally } = require("./location");
const { tankBehavior } = require("./behavior/unit-behavior");
const enemyTrackingService = require("../systems/enemy-tracking/enemy-tracking-service");
const { createUnitCommand } = require("../services/actions-service");
const { STOP } = require("@node-sc2/core/constants/ability");

/**
 * 
 * @param {World} world 
 * @param {UnitTypeId[]} supportUnitTypes 
 * @param {Point2D} rallyPoint 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function rallyUnits(world, supportUnitTypes, rallyPoint = null) {
  const { resources } = world
  const { units } = resources.get();
  const collectedActions = [];
  const combatUnits = units.getCombatUnits().filter(unit => unit.labels.size === 0);
  const label = 'defending';
  units.withLabel(label).forEach(unit => {
    unit.labels.delete(label) && collectedActions.push(createUnitCommand(STOP, [unit]));
  });
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
    const selfUnits = [...combatUnits, ...supportUnits];
    const enemyUnits = enemyTrackingService.mappedEnemyUnits.filter(unit => !(unit.unitType === LARVA));
    collectedActions.push(...engageOrRetreat(world, selfUnits, enemyUnits, rallyPoint));
  }
  collectedActions.push(...tankBehavior(units, rallyPoint));
  return collectedActions;
}

module.exports = rallyUnits;