//@ts-check
"use strict"

const { Alliance } = require('@node-sc2/core/constants/enums');
const { getById } = require('../unit-retrieval');
const { UnitType } = require('@node-sc2/core/constants');

/**
 * Analyzes the game state and determines if the current count of a 
 * specific unit type matches the target count.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} targetCount
 * @returns {boolean}
 */
function checkUnitCount(world, unitType, targetCount) {
  const { data, resources } = world;
  const { units } = resources.get();
  const orders = [];
  /** @type {UnitTypeId[]} */
  let unitTypes = []; // Assign an empty array as default

  if (morphMapping.has(unitType)) {
    const mappingValue = morphMapping.get(unitType);
    if (mappingValue) {
      unitTypes = mappingValue;
    }
  } else {
    unitTypes = [unitType];
  }
  let abilityId = data.getUnitTypeData(unitType).abilityId;

  if (typeof abilityId === 'undefined') {
    // Ability ID for the unit type is not defined, so return false
    return false;
  }
  units.withCurrentOrders(abilityId).forEach(unit => {
    if (unit.orders) {
      unit.orders.forEach(order => {
        if (order.abilityId === abilityId) {
          // Check if the unitType is zergling and account for the pair
          const orderCount = (unitType === UnitType.ZERGLING) ? 2 : 1;
          for (let i = 0; i < orderCount; i++) {
            orders.push(order);
          }
        }
      });
    }
  });

  const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => {
    const unitPendingOrders = unitService.getPendingOrders(u);
    return unitPendingOrders && unitPendingOrders.some(o => o.abilityId === abilityId);
  });

  let adjustedTargetCount = targetCount;
  if (unitType === UnitType.ZERGLING) {
    const existingZerglings = getById(resources, [UnitType.ZERGLING]).length;
    const oddZergling = existingZerglings % 2;
    adjustedTargetCount += oddZergling;
  }

  const unitCount = getById(resources, unitTypes).length + orders.length + unitsWithPendingOrders.length + trackUnitsService.missingUnits.filter(unit => unit.unitType === unitType).length;

  return unitCount === adjustedTargetCount;
}

/**
 * Gets potential combatant units within a certain radius.
 * 
 * @param {World} world - The current state of the world.
 * @param {Unit} unit - The reference unit to check radius around.
 * @param {number} radius - The radius to check for units.
 * @returns {Unit[]} - Array of potential combatant units.
 */
function getPotentialCombatantsInRadius(world, unit, radius) {
  // Destructure to get the units directly
  const units = world.resources.get().units;

  // Use a single filtering operation to get potential combatants in the given radius.
  return units.getAlive(Alliance.SELF).filter(targetUnit => {
    // Check if both units have valid positions
    if (!unit.pos || !targetUnit.pos) return false;

    // Check if the target unit is within the radius
    const isWithinRadius = getDistance(unit.pos, targetUnit.pos) <= radius;
    // Check if the target unit is a potential combatant
    const isPotentialCombatant = unitService.potentialCombatants(targetUnit);
    return isWithinRadius && isPotentialCombatant;
  });
}

module.exports = {
  checkUnitCount,
  getPotentialCombatantsInRadius,
};