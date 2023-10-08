const { getSelfUnits } = require('../unit-retrieval');

/**
  * @param {UnitResource} units
  * @param {Unit} unit
  * @param {Unit[]} mappedEnemyUnits
  * @returns {boolean}
  */
const isByItselfAndNotAttacking = (units, unit, mappedEnemyUnits) => {
  const isByItself = getSelfUnits(units, unit, mappedEnemyUnits, 8).length === 1;
  const isAttacking = unit.labels.get('hasAttacked');
  return isByItself && !isAttacking;
}

module.exports = {
  isByItselfAndNotAttacking
};
