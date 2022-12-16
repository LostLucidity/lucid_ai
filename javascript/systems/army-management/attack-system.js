//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { UnitType } = require("@node-sc2/core/constants");
const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getRandomPoint } = require("../../helper/location");
const { createUnitCommand } = require("../../services/actions-service");
const foodUsedService = require("../../services/food-used-service");
const { getDistance } = require("../../services/position-service");
const { getClosestUnitByPath } = require("../../services/resource-manager-service");
const { canAttack } = require("../../services/resources-service");
const { getWeaponThatCanAttack } = require("../../services/unit-service");
const { micro } = require("../../services/world-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");

module.exports = createSystem({
  name: 'AttackSystem',
  type: 'agent',
  async onStep(world) {
    // if foodUsed is greater than minimumAmountToAttackWith, attack
    const { agent, resources } = world;
    const { map } = resources.get();
    const { actions, units } = resources.get();
    const unitsToAttackWith = getUnitsToAttackWith(units);
    const collectedActions = [];
    if (unitsToAttackWith.length > 0) {
      const attack = agent.foodUsed >= foodUsedService.minimumAmountToAttackWith;
      const enemyUnits = attack ? enemyTrackingService.mappedEnemyUnits : getUnitsWithinBaseRange(units);
      const enemyTargets = getEnemyTargets(enemyUnits)
      // get all units capable of moving except for structures and workers
      if (enemyTargets.length > 0) {
        collectedActions.push(...attackTargets(world, unitsToAttackWith, enemyTargets));
        if (collectedActions.length > 0) {
          return actions.sendAction(collectedActions);
        }
      } else {
        if (attack) {
          collectedActions.push(...findEnemy(map, unitsToAttackWith));
        }
      }
    }
    if (collectedActions.length > 0) {
      return actions.sendAction(collectedActions);
    }
  }
});
/**
 * @param {Unit[]} enemyUnits 
 * @returns {Unit[]}
 */
function getEnemyTargets(enemyUnits) {
  // get all enemy structures
  let enemyTargets = enemyUnits.filter(unit => unit.isStructure());
  // if no enemy structures, attack all enemy units
  if (enemyTargets.length === 0) {
    enemyTargets = enemyUnits;
  }
  return enemyTargets;
}
/**
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getUnitsWithinBaseRange(units) {
  // get all self structures and enemy units in range of structures
  const selfStructures = units.getAlive(Alliance.SELF).filter(unit => unit.isStructure());
  return units.getAlive(Alliance.ENEMY).filter(unit => selfStructures.some(structure => distance(unit.pos, structure.pos) <= 16));
}
/**
 * @param {World} world
 * @param {Unit[]} unitsToAttackWith 
 * @param {Unit[]} enemyTargets
 */
function attackTargets(world, unitsToAttackWith, enemyTargets) {
  const { resources } = world;
  const collectedActions = [];
  unitsToAttackWith.forEach(unit => {
    const { pos, unitType } = unit; if (pos === undefined || unitType === undefined) { return; }
    const abilityId = unit.abilityAvailable(ATTACK_ATTACK) ? ATTACK_ATTACK : MOVE;
    const unitTypeName = getUnitTypeName(unitType); if (unitTypeName === undefined) { return; }
    const attackableTargets = enemyTargets.filter(target => canAttack(resources, unit, target, false));
    const [closestEnemyUnit] = getClosestUnitByPath(resources, pos, attackableTargets);
    if (closestEnemyUnit) {
      const { pos : closestEnemyUnitPos } = closestEnemyUnit; if (closestEnemyUnitPos === undefined) { return; }
      if (getDistance(pos, closestEnemyUnitPos) > 16) {
        const unitCommand = createUnitCommand(abilityId, [unit]);
        unitCommand.targetWorldSpacePos = closestEnemyUnitPos;
        collectedActions.push(unitCommand);
      } else {
        collectedActions.push(...micro(world, unit));
      }
    }
  });
  return collectedActions;
}
/**
 * @param {MapResource} map
 * @param {Unit[]} unitsToAttackWith
 */
function findEnemy(map, unitsToAttackWith) {
  const collectedActions = [];
  unitsToAttackWith.forEach(unit => {
    if (unit.isIdle()) {
      const randomPosition = getRandomPoint(map);
      if (randomPosition) {
        const unitCommand = createUnitCommand(MOVE, [unit]);
        unitCommand.targetWorldSpacePos = randomPosition;
        collectedActions.push(unitCommand);
      }
    }
  });
  return collectedActions;
}
/**
 * @param {UnitResource} units 
 * @returns {Unit[]}
 */
function getUnitsToAttackWith(units) {
  // exclude overlords, structures, workers and can't move
  return units.getAlive(Alliance.SELF).filter(unit => {
    return (
      !unit.isStructure() &&
      !unit.isWorker() &&
      unit.abilityAvailable(MOVE)
    );
  });
}

/**
 * @param {UnitTypeId} unitType
 * @returns {string | undefined}
 */
function getUnitTypeName(unitType) {
  return Object.keys(UnitType).find(type => UnitType[type] === unitType);
}
/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {boolean}
 */
function isInWeaponRange(data, unit, targetUnit) {
  const { pos, radius, unitType } = unit; if (pos === undefined || radius === undefined || unitType === undefined) { return false; }
  const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, targetUnit); if (weaponThatCanAttack === undefined) { return false; }
  const { range } = weaponThatCanAttack; if (range === undefined) { return false; }
  const { pos: targetPos, radius: targetRadius } = targetUnit; if (targetPos === undefined || targetRadius === undefined) { return false; }
  return getDistance(pos, targetPos) <= range + radius + targetRadius;

}

