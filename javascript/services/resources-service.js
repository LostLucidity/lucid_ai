//@ts-check
"use strict"

const { CloakState } = require("@node-sc2/core/constants/enums");

const resourcesService = {
  /**
   * Checks whether unit can attack targetUnit.
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @param {boolean} requireVisible
   * @return {boolean}
   */
  canAttack(unit, targetUnit, requireVisible = true) {
    const { cloak, isFlying, pos } = targetUnit;

    if (!pos) {
      return false;
    }

    const canShootAtTarget = isFlying ? unit.canShootUp() : unit.canShootGround();
    const targetDetected = cloak !== CloakState.CLOAKED;

    const visibilityCondition = requireVisible ? targetUnit.isCurrent() : true;

    return canShootAtTarget && targetDetected && visibilityCondition;
  }
}

module.exports = resourcesService;