//@ts-check
"use strict"

const { Ability } = require("@node-sc2/core/constants");
const { CloakState, Alliance } = require("@node-sc2/core/constants/enums");
const { BARRACKS, FACTORY, STARPORT } = require("@node-sc2/core/constants/unit-type");
const { createUnitCommand } = require("./actions-service");
const { getDistance, moveAwayPosition } = require("./position-service");
const { getClosestUnitByPath, getCombatRally } = require("./resource-manager-service");

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
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  setCombatBuildingsRallies: (resources) => {
    const { units } = resources.get();
    const collectedActions = [];
    units.getById([BARRACKS, FACTORY, STARPORT]).forEach(building => {
      const { pos, buildProgress } = building; if (pos === undefined || buildProgress === undefined) { return []; }
      if (buildProgress < 1) { return []; }
      const foundRallyAbility = building.availableAbilities().find(ability => ability === Ability.RALLY_BUILDING);
      if (foundRallyAbility) {
        const unitCommand = createUnitCommand(foundRallyAbility, [building]);
        let rallyPosition = getCombatRally(resources);
        const [closestEnemyUnit] = units.getClosest(pos, units.getAlive(Alliance.ENEMY)).filter(enemyUnit => enemyUnit.pos && getDistance(enemyUnit.pos, pos) < 16);
        if (closestEnemyUnit && building['selfDPSHealth'] < closestEnemyUnit['selfDPSHealth']) {
          const { pos: enemyPos } = closestEnemyUnit; if (enemyPos === undefined) { return []; }
          rallyPosition = moveAwayPosition(enemyPos, pos);
        }
        unitCommand.targetWorldSpacePos = rallyPosition;
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  /**
   * @param {ResourceManager} resources 
   * @param {Unit[]} units 
   * @param {Unit} target 
   * @returns {Unit}
   */
  setCombatPoint: (resources, units, target) => {
    const [combatPoint] = getClosestUnitByPath(resources, target.pos, units);
    combatPoint.labels.set('combatPoint', true);
    return combatPoint;
  },
}

module.exports = resourcesService;