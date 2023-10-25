//@ts-check
"use strict"

const { ATTACK_ATTACK, MOVE, ATTACK } = require("@node-sc2/core/constants/ability");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { SIEGETANKSIEGED, BUNKER, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getInRangeUnits, getInRangeDestructables } = require("../helper/battle-analysis");
const { calculateNearSupply } = require("./data-service");
const { moveAwayPosition, getDistance, getBorderPositions } = require("./position-service");
const { tankBehavior } = require("../systems/unit-resource/unit-resource-service");
const unitService = require("./unit-service");
const { createUnitCommand } = require("../src/services/command-service");

const armyManagementService = {
  /** @type {Unit[]} */
  attackingInRange: [],
  defenseMode: false,
  attackWithArmy: (data, units, army) => {
    const collectedActions = [];
    const pointType = army.combatPoint.unitType;
    const pointTypeUnits = units.getById(pointType);
    const nonPointTypeUnits = army.selfCombatUnits.filter(unit => !(unit.unitType === pointType));
    const pointTypeUnitTags = pointTypeUnits.map(unit => unit.tag);
    const nonPointTypeUnitTags = nonPointTypeUnits.map(unit => unit.tag);
    const range = Math.max.apply(Math, data.getUnitTypeData(SIEGETANKSIEGED).weapons.map(weapon => { return weapon.range; }));
    const targetWorldSpacePos = distance(army.combatPoint.pos, army.enemyTarget.pos) > range ? army.combatPoint.pos : army.enemyTarget.pos;
    let unitCommand = {
      abilityId: ATTACK_ATTACK,
      targetWorldSpacePos: targetWorldSpacePos,
      unitTags: [...pointTypeUnitTags, ...nonPointTypeUnitTags],
    }
    collectedActions.push(unitCommand);
    const changelings = [13, 14, 15, 16];
    if (changelings.includes(army.enemyTarget.unitType)) {
      const killChanglingCommand = {
        abilityId: ATTACK,
        targetUnitTag: army.enemyTarget.tag,
        unitTags: [...pointTypeUnitTags],
      }
      collectedActions.push(killChanglingCommand);
    } else {
      unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: army.enemyTarget.pos,
        unitTags: [army.combatPoint.tag],
      }
      collectedActions.push(unitCommand);
    }
    collectedActions.push(...tankBehavior(units));
    return collectedActions;
  },
  calculateSupplyPower(data, unit, Units) {
    return calculateNearSupply(data, getInRangeUnits(unit, Units));
  },
  /**
   * 
   * @param {World} world 
   * @param {Unit[]} selfUnits 
   * @param {Unit[]} enemyUnits 
   * @param {Point2D} position 
   * @param {Boolean} clearRocks 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  engageOrRetreat: (world, selfUnits, enemyUnits, position, clearRocks = true) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    armyManagementService.attackingInRange = selfUnits.filter(unit => {
      if (unit.isAttacking()) {
        const { orders, pos, radius, unitType } = unit; if (orders === undefined || pos === undefined || radius === undefined || unitType === undefined) { return false; }
        const attackingOrder = orders.find(order => order.abilityId === ATTACK_ATTACK); if (attackingOrder === undefined) { return false; }
        const { targetUnitTag } = attackingOrder; if (targetUnitTag === undefined) { return false; }
        const targetUnit = units.getByTag(targetUnitTag); if (targetUnit === undefined) { return false; }
        const { pos: targetPos, radius: targetRadius } = targetUnit; if (targetPos === undefined || targetRadius === undefined) { return false; }
        const weapon = unitService.getWeaponThatCanAttack(data, unitType, targetUnit); if (weapon === undefined) { return false; }
        const { range } = weapon; if (range === undefined) { return false; }
        const shootingRange = range + radius + targetRadius;
        return distance(pos, targetPos) < shootingRange;
      }
    });
    selfUnits.forEach(selfUnit => {
      let targetPosition = position;
      if (!workerTypes.includes(selfUnit.unitType)) {
        const [closestEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(enemyUnit => distance(selfUnit.pos, enemyUnit.pos) < 16));
        if (closestEnemyUnit) {
          closestEnemyUnit['inRangeUnits'] = getInRangeUnits(closestEnemyUnit, enemyUnits);
          const enemySupply = calculateNearSupply(data, closestEnemyUnit['inRangeUnits']);
          closestEnemyUnit['inRangeSelfUnits'] = getInRangeUnits(closestEnemyUnit, selfUnits);
          closestEnemyUnit['inRangeSelfSupply'] = calculateNearSupply(data, closestEnemyUnit['inRangeSelfUnits']);
          const inRangeSelfUnits = getInRangeUnits(selfUnit, selfUnits);
          selfUnit['selfSupply'] = calculateNearSupply(data, inRangeSelfUnits);
          const selfSupply = selfUnit['selfSupply'] > closestEnemyUnit['inRangeSelfSupply'] ? selfUnit['selfSupply'] : closestEnemyUnit['inRangeSelfSupply'];
          const noBunker = units.getById(BUNKER).length === 0;
          if (enemySupply > selfSupply && noBunker) {
            let targetWorldSpacePos;
            const isFlying = selfUnit.isFlying;
            if (isFlying) {
              targetWorldSpacePos = moveAwayPosition(map, closestEnemyUnit.pos, selfUnit.pos);
            } else {
              targetWorldSpacePos = armyManagementService.retreat(world, selfUnit, [closestEnemyUnit]);
            }
            if (targetWorldSpacePos) {
              const unitCommand = {
                abilityId: MOVE,
                targetWorldSpacePos: targetWorldSpacePos,
                unitTags: [selfUnit.tag],
              }
              collectedActions.push(unitCommand);
            }
          } else {
            const unitCommand = {
              abilityId: ATTACK_ATTACK,
              targetUnitTag: closestEnemyUnit.tag,
              unitTags: [selfUnit.tag],
            }
            collectedActions.push(unitCommand);
          }
        } else {
          if (selfUnit.unitType !== QUEEN) {
            const unitCommand = {
              abilityId: ATTACK_ATTACK,
              unitTags: [selfUnit.tag],
            }
            const destructable = getInRangeDestructables(units, selfUnit);
            if (destructable && clearRocks) {
              const { pos, radius } = destructable; if (pos === undefined || radius === undefined) { return; }
              const { pos: selfPos, radius: selfRadius, unitType: selfUnitType } = selfUnit; if (selfPos === undefined || selfRadius === undefined || selfUnitType === undefined) { return; }
              const weapon = unitService.getWeaponThatCanAttack(data, selfUnitType, destructable); if (weapon === undefined) { return; }
              const { range } = weapon; if (range === undefined) { return; }
              const attackRadius = radius + selfRadius + range;
              const destructableBorderPositions = getBorderPositions(pos, attackRadius);
              const fitablePositions = destructableBorderPositions.filter(borderPosition => {
                return armyManagementService.attackingInRange.every(attackingInRangeUnit => {
                  const { pos: attackingInRangePos, radius: attackingInRangeRadius } = attackingInRangeUnit; if (attackingInRangePos === undefined || attackingInRangeRadius === undefined) { return false; }
                  const distanceFromAttackingInRangeUnit = getDistance(borderPosition, attackingInRangePos);
                  return distanceFromAttackingInRangeUnit > attackingInRangeRadius + selfRadius;
                });
              }).sort((a, b) => getDistance(a, selfPos) - getDistance(b, selfPos));
              if (fitablePositions.length > 0 && getDistance(pos, selfPos) > attackRadius + 1) {
                targetPosition = fitablePositions[0];
                const moveUnitCommand = createUnitCommand(MOVE, [selfUnit]);
                moveUnitCommand.targetWorldSpacePos = targetPosition;
                collectedActions.push(moveUnitCommand);
                unitCommand.queueCommand = true;
              }
              unitCommand.targetUnitTag = destructable.tag;
            }
            else {
              if (unitHasTargetPosition(selfUnit, targetPosition)) {
                unitCommand.targetWorldSpacePos = targetPosition;
              }
            }
            collectedActions.push(unitCommand);
          }
        }
      }
    });
    return collectedActions;
  }
}

module.exports = armyManagementService;

/**
 * @param {Unit} unit
 * @param {Point2D} targetPosition
 * @returns {Boolean}
 */
function unitHasTargetPosition(unit, targetPosition) {
  const { orders, pos } = unit;
  const defaultDistance = 12;
  if (orders === undefined || pos === undefined) { return false; }
  const orderFound = orders.some(order => {
    const { targetWorldSpacePos } = order;
    if (targetWorldSpacePos === undefined) return false;
    return getDistance(targetWorldSpacePos, targetPosition) < defaultDistance;
  });
  return !orderFound && getDistance(pos, targetPosition) > defaultDistance;
}
