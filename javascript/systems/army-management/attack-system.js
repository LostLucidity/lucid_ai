//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getRandomPoint } = require("../../helper/location");
const { createUnitCommand } = require("../../services/actions-service");
const { getDistance } = require("../../services/position-service");
const { getClosestUnitByPath, getCombatRally } = require("../../services/resource-manager-service");
const { canAttack } = require("../../services/resources-service");
const { micro, getWorkerDefenseCommands } = require("../../services/world-service");
const enemyTrackingService = require("../enemy-tracking/enemy-tracking-service");

module.exports = createSystem({
  name: 'AttackSystem',
  type: 'agent',
  async onStep(world) {
    const { agent, resources } = world;
    const { foodUsed } = agent; if (foodUsed === undefined) { return; }
    const { map } = resources.get();
    const { actions, units } = resources.get();
    let unitsToAttackWith = getUnitsToAttackWith(units);
    /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
    const collectedActions = [];
    if (unitsToAttackWith.length > 0) {
      const workersDefending = unitsToAttackWith.some(unit => unit.isWorker());
      const enemyUnits = workersDefending ? getUnitsWithinBaseRange(units) : enemyTrackingService.mappedEnemyUnits;
      const enemyTargets = getEnemyTargets(enemyUnits);
      if (enemyTargets.length > 0) {
        if (workersDefending) {
          const [closestEnemy] = getClosestUnitByPath(resources, getCombatRally(resources), enemyTargets);
          collectedActions.push(...getWorkerDefenseCommands(world, unitsToAttackWith, closestEnemy));
        } else {
          collectedActions.push(...attackTargets(world, unitsToAttackWith, enemyTargets));
        }
        if (collectedActions.length > 0) {
          return actions.sendAction(collectedActions);
        }
      } else {
        collectedActions.push(...findEnemy(map, unitsToAttackWith));
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
  const { units } = resources.get();
  const collectedActions = [];
  unitsToAttackWith.forEach(unit => {
    const { orders, pos, unitType } = unit; if (orders === undefined || pos === undefined || unitType === undefined) { return; }
    const abilityId = unit.abilityAvailable(ATTACK_ATTACK) ? ATTACK_ATTACK : MOVE;
    const attackableTargets = enemyTargets.filter(target => canAttack(resources, unit, target, false));
    if (orders.length > 0 && orders[0].abilityId === ATTACK_ATTACK) {
      const { targetUnitTag } = orders[0]; if (targetUnitTag === undefined) { return; }
      const target = units.getByTag(targetUnitTag); if (target === undefined) { return; }
      if (!attackableTargets.some(target => target.tag === targetUnitTag)) {
        attackableTargets.push(target);
      }
    }
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
    if (unit.isIdle() && !unit.isWorker()) {
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
  const unitsToAttackWith = units.getAlive(Alliance.SELF).filter(unit => {
    return (
      !unit.isStructure() &&
      !unit.isWorker() &&
      unit.abilityAvailable(MOVE)
    );
  });
  if (unitsToAttackWith.length === 0) {
    return units.getAlive(Alliance.SELF).filter(unit => unit.isWorker());
  }
  return unitsToAttackWith;
}

