//@ts-check
"use strict"

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