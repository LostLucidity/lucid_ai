//@ts-check
"use strict"

const { createSystem } = require("@node-sc2/core");
const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { OVERLORD } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getRandomPoint } = require("../../helper/location");
const { createUnitCommand } = require("../../services/actions-service");
const foodUsedService = require("../../services/food-used-service");
const { canAttack } = require("../../services/resources-service");

module.exports = createSystem({
  name: 'AttackSystem',
  type: 'agent',
  async onStep(world) {
    // if foodUsed is greater than minimumAmountToAttackWith, attack
    const { agent, resources } = world;
    const { map } = resources.get();
    const { actions, units } = resources.get();
    const unitsToAttackWith = getUnitsToAttackWith(units);
    if (unitsToAttackWith.length > 0) {
      const attack = agent.foodUsed >= foodUsedService.minimumAmountToAttackWith;
      const enemyUnits = attack ? units.getAlive(Alliance.ENEMY) : getUnitsWithinBaseRange(units);
      const enemyTargets = getEnemyTargets(enemyUnits)
      // get all units capable of moving except for structures and workers
      const collectedActions = [];
      if (enemyTargets.length > 0) {
        collectedActions.push(...attackTargets(resources, unitsToAttackWith, enemyTargets));
        if (collectedActions.length > 0) {
          return actions.sendAction(collectedActions);
        }
      } else {
        if (attack) {
          collectedActions.push(...findEnemy(map, unitsToAttackWith));
        }
      }
      if (collectedActions.length > 0) {
        return actions.sendAction(collectedActions);
      }
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
 * @param {ResourceManager} resources
 * @param {Unit[]} unitsToAttackWith 
 * @param {Unit[]} enemyTargets
 */
function attackTargets(resources, unitsToAttackWith, enemyTargets) {
  const { units } = resources.get();
  const collectedActions = [];
  unitsToAttackWith.forEach(unit => {
    const { pos } = unit;
    if (pos === undefined) { return; }
    const abilityId = unit.abilityAvailable(ATTACK_ATTACK) ? ATTACK_ATTACK : MOVE;
    if (unit.unitType !== OVERLORD) {
      const attackableTargets = enemyTargets.filter(target => canAttack(resources, unit, target, false));
      const [closestEnemyUnit] = units.getClosest(pos, attackableTargets);
      if (closestEnemyUnit) {
        const unitCommand = createUnitCommand(abilityId, [unit]);
        unitCommand.targetWorldSpacePos = closestEnemyUnit.pos;
        collectedActions.push(unitCommand);
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