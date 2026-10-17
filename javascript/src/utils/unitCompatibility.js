const { Ability } = require("@node-sc2/core/constants");

const attackAbilities = new Set([
  Ability.ATTACK,
  Ability.ATTACK_ATTACK,
]);

/**
 * @param {Unit} unit
 * @returns {boolean}
 */
function isAttacking(unit) {
  return Array.isArray(unit.orders) && unit.orders.some(order =>
    attackAbilities.has(order.abilityId)
  );
}

/**
 * @param {Unit} unit
 * @returns {boolean}
 */
function isHarvesting(unit) {
  return unit.isGathering() || unit.isReturning();
}

module.exports = {
  isAttacking,
  isHarvesting,
};
