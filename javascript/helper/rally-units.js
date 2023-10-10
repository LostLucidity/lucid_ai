//@ts-check
"use strict"

const { BUNKER, LARVA } = require("@node-sc2/core/constants/unit-type");
const { createUnitCommand } = require("../services/actions-service");
const { STOP } = require("@node-sc2/core/constants/ability");
const { tankBehavior } = require("../systems/unit-resource/unit-resource-service");
const armyManagementService = require("../src/services/army-management/army-management-service");
const enemyTrackingService = require("../src/services/enemy-tracking");

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
  const combatUnits = units.getCombatUnits().filter(unit => {
    // Check if a unit does not have any labels or only has the 'combatPoint' label
    return unit.labels.size === 0 || (unit.labels.size === 1 && unit.labels.has('combatPoint'));
  });
  const label = 'defending';
  units.withLabel(label).forEach(unit => {
    unit.labels.delete(label) && collectedActions.push(createUnitCommand(STOP, [unit]));
  });
  if (!rallyPoint) {
    rallyPoint = armyManagementService.getCombatRally(resources);
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
    collectedActions.push(...armyManagementService.engageOrRetreat(world, selfUnits, enemyUnits, rallyPoint));
  }
  collectedActions.push(...tankBehavior(units));
  return collectedActions;
}

module.exports = rallyUnits;