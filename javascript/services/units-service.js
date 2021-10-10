//@ts-check
"use strict"

const { EFFECT_REPAIR } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { gridsInCircle } = require("@node-sc2/core/utils/geometry/angle");
const { distance } = require("@node-sc2/core/utils/geometry/point");

const unitService = {
  /**
   * Checks whether unit can attack targetUnit.
   * @param {{ get: () => { map: any; units: any; }; }} resources
   * @param {{ isFlying: any; isMelee: () => any; }} unit
   * @param {{ isFlying: any; pos: any; radius: any; }} targetUnit
   * @return {boolean}
   */
  canAttack(resources, unit, targetUnit) {
    const { map, units } = resources.get();
    const rangedGroundUnit = !unit.isFlying && !unit.isMelee();
    if (rangedGroundUnit && targetUnit.isFlying) {
      const inRangeOfVisionAndVisible = gridsInCircle(targetUnit.pos, targetUnit.radius, { normalize: true }).some(grid => map.isVisible(grid)) && unitService.inSightRange(units.getAlive(Alliance.SELF), targetUnit);
      return inRangeOfVisionAndVisible;
    }
    return true;
  },
  deleteLabel(units, label) {
    units.withLabel(label).forEach(pusher => pusher.labels.delete(label));
  },
  /**
   * Returns whether target unit is in sightRange of unit.
   * @param {any[]} units
   * @param {{ isFlying?: any; pos: any; radius?: any; }} targetUnit
   * @return {boolean}
   */
  inSightRange(units, targetUnit) {
    return units.some(unit => {
      const targetUnitDistanceToItsEdge = distance(unit.pos, targetUnit.pos) - targetUnit.radius;
      return unit.data().sightRange >= targetUnitDistanceToItsEdge;
    });
  },
  isRepairing(unit) {
    return unit.orders.some(order => order.abilityId === EFFECT_REPAIR);
  },
  getEnemyWorkers(world) {
    const workers = world.resources.get().units.getAlive(Alliance.ENEMY)
      .filter(u => u.unitType === WorkerRace[world.agent.race]);
    return workers;
  },
  isWorker(unit) {
    return workerTypes.includes(unit.unitType);
  }
}

module.exports = unitService