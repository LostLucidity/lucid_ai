//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA } = require("@node-sc2/core/constants/unit-type");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const { scanCloakedEnemy } = require("../terran");
const { searchAndDestroy } = require("../../services/resource-manager-service");
const { groupUnits } = require("../../services/unit-service");

const armyBehavior = {
  /**
   * 
   * @param {World} world 
   * @param {UnitTypeId[]} mainCombatTypes 
   * @param {UnitTypeId[]} supportUnitTypes 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  attack: (world, mainCombatTypes, supportUnitTypes) => {
    const { resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = pathFindingService.getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), getGasGeysers(units), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [closestEnemyUnit] = units.getClosest(avgCombatUnitsPoint, enemyUnits, 1);
    if (closestEnemyBase || closestEnemyUnit) {
      const enemyTarget = closestEnemyBase || closestEnemyUnit;
      const combatPoint = armyManagementService.getCombatPoint(resources, combatUnits, enemyTarget);
      if (combatPoint) {
        const army = { combatPoint, combatUnits, supportUnits, enemyTarget }
        collectedActions.push(...attackWithArmy(world, army, enemyUnits));
      }
      collectedActions.push(...scanCloakedEnemy(units, enemyTarget, combatUnits));
    } else {
      collectedActions.push(...searchAndDestroy(resources, combatUnits, supportUnits));
    }
    return collectedActions;
  },
};

module.exports = armyBehavior;

