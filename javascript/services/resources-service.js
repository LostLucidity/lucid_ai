//@ts-check
"use strict"

const { CloakState } = require("@node-sc2/core/constants/enums");
const { getDistanceByPath } = require("./resource-manager-service");

const resourcesService = {
  /**
 * Checks whether unit can attack targetUnit.
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @param {boolean} requireVisible
 * @return {boolean}
 */
  canAttack(resources, unit, targetUnit, requireVisible = true) {
    const { map } = resources.get();
    const { cloak, isFlying, pos } = targetUnit;
    if (cloak === undefined || isFlying === undefined || pos === undefined) { return false; }
    const canShootAtTarget = isFlying && unit.canShootUp() || !isFlying && unit.canShootGround();
    const targetDetected = cloak !== CloakState.CLOAKED;
    const conditions = [
      canShootAtTarget,
      targetDetected,
      !requireVisible || map.isVisible(pos),
    ];
    return conditions.every(condition => condition);
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} targetUnit 
   * @returns {Unit}
   */
  getCombatPoint: (resources, units, targetUnit) => {
    const label = 'combatPoint';
    const combatPoint = units.find(unit => unit.labels.get(label));
    if (combatPoint) {
      let sameTarget = false;
      if (combatPoint.orders[0]) {
        const filteredOrder = combatPoint.orders.filter(order => !!order.targetWorldSpacePos)[0];
        sameTarget = filteredOrder && (Math.round(filteredOrder.targetWorldSpacePos.x * 2) / 2) === targetUnit.pos.x && (Math.round(filteredOrder.targetWorldSpacePos.y * 2) / 2) === targetUnit.pos.y;
      }
      if (sameTarget) {
        return combatPoint;
      } else {
        combatPoint.labels.delete(label);
        return resourcesService.setCombatPoint(resources, units, targetUnit);
      }
    } else {
      return resourcesService.setCombatPoint(resources, units, targetUnit);
    }
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} target 
   * @returns {Unit}
   */
  setCombatPoint: (resources, units, target) => {
    const [combatPoint] = resourcesService.getClosestUnitByPath(resources, target.pos, units);
    combatPoint.labels.set('combatPoint', true);
    return combatPoint;
    // let closestUnit;
    // try {
    //   [closestUnit] = getClosestUnitByPath(resources, target.pos, units);
    //   closestUnit.labels.set('combatPoint', true);
    // } catch (e) {
    //   let closestUnit;
    //   [closestUnit] = resources.get().units.getClosest(target.pos, units)
    // }
    // return closestUnit;
  },
}

module.exports = resourcesService;