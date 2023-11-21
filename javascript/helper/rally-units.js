//@ts-check
"use strict"

const { BUNKER } = require("@node-sc2/core/constants/unit-type");
const { STOP } = require("@node-sc2/core/constants/ability");
const { tankBehavior } = require("../systems/unit-resource/unit-resource-service");

/**
 * Rallies units to a specified point or a default location.
 * 
 * @param {World} world - The world context containing resources and units.
 * @param {UnitTypeId[]} supportUnitTypes - Array of support unit types IDs.
 * @param {Point2D} [rallyPoint=null] - The rally point for units; uses a default location if not provided.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - Array of unit commands.
 */
function rallyUnits(world, supportUnitTypes, rallyPoint = null) {
  console.log('rallyUnits');
  const { resources } = world;
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
    rallyPoint = getCombatRally(resources);
  }

  const processedUnits = new Set();

  combatUnits.forEach(referenceUnit => {
    if (!processedUnits.has(referenceUnit)) {
      const unitsForEngagement = armyManagementService.getUnitsForEngagement(world, referenceUnit, 16);

      const enemyUnits = filterEnemyUnits(referenceUnit, enemyTrackingService.mappedEnemyUnits);

      // Mark units as processed
      unitsForEngagement.forEach(unit => processedUnits.add(unit));

      // Use the selected units for engagement or retreat
      collectedActions.push(...armyManagementService.engageOrRetreat(world, unitsForEngagement, enemyUnits, rallyPoint));
    }
  });

  // Include the logic for support units and bunkers as before
  const supportUnits = [];
  supportUnitTypes.forEach(type => {
    supportUnits.concat(units.getById(type).filter(unit => unit.labels.size === 0));
  });

  if (units.getById(BUNKER).filter(bunker => bunker.buildProgress >= 1).length > 0) {
    const [bunker] = units.getById(BUNKER);
    rallyPoint = bunker.pos;
  }

  collectedActions.push(...tankBehavior(units));
  return collectedActions;
}


module.exports = rallyUnits;