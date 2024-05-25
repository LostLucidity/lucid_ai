// Imports
const StrategyContext = require('./strategyContext');

/**
 * Selects a unit type to build from the list of candidate types.
 * @param {World} world The game world context.
 * @param {UnitTypeId[]} candidateTypes The candidate unit types for training.
 * @returns {UnitTypeId | null} The selected unit type to build, or null if none is selected.
 */
function selectUnitTypeToBuild(world, candidateTypes) {
  return StrategyContext.selectTypeToBuild(world, candidateTypes);
}

module.exports = {
  selectUnitTypeToBuild,
};
