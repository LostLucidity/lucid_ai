//@ts-check
"use strict"

const { ATTACK_ATTACK, MOVE, ATTACK } = require("@node-sc2/core/constants/ability");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { SIEGETANKSIEGED, BUNKER, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { getInRangeUnits, getInRangeDestructables } = require("../helper/battle-analysis");
const { tankBehavior } = require("../helper/behavior/unit-behavior");
const { calculateNearSupply } = require("./data-service");
const { moveAwayPosition } = require("./position-service");
const { retreat } = require("./world-service");

const armyManagementService = {
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
    const { units } = resources.get();
    const collectedActions = [];
    selfUnits.forEach(selfUnit => {
      let targetPosition = position;
      if (!workerTypes.includes(selfUnit.unitType)) {
        const [closestEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(enemyUnit => distance(selfUnit.pos, enemyUnit.pos) < 16));
        if (closestEnemyUnit) {
          closestEnemyUnit.inRangeUnits = getInRangeUnits(closestEnemyUnit, enemyUnits);
          const enemySupply = calculateNearSupply(data, closestEnemyUnit.inRangeUnits);
          closestEnemyUnit.inRangeSelfUnits = getInRangeUnits(closestEnemyUnit, selfUnits);
          closestEnemyUnit.inRangeSelfSupply = calculateNearSupply(data, closestEnemyUnit.inRangeSelfUnits);
          const inRangeSelfUnits = getInRangeUnits(selfUnit, selfUnits);
          selfUnit.selfSupply = calculateNearSupply(data, inRangeSelfUnits);
          const selfSupply = selfUnit.selfSupply > closestEnemyUnit.inRangeSelfSupply ? selfUnit.selfSupply : closestEnemyUnit.inRangeSelfSupply;
          const noBunker = units.getById(BUNKER).length === 0;
          if (enemySupply > selfSupply && noBunker) {
            let targetWorldSpacePos;
            const isFlying = selfUnit.isFlying;
            if (isFlying) {
              targetWorldSpacePos = moveAwayPosition(closestEnemyUnit, selfUnit);
            } else {
              targetWorldSpacePos = retreat(world, selfUnit, closestEnemyUnit);
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
            const destructableTag = getInRangeDestructables(units, selfUnit);
            if (destructableTag && clearRocks) { unitCommand.targetUnitTag = destructableTag; }
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
  if (orders === undefined || pos === undefined) { return false; }
  const orderFound = orders.some(order => {
    const { targetWorldSpacePos } = order;
    if (targetWorldSpacePos === undefined) return false;
    return distance(targetWorldSpacePos, targetPosition) < 16;
  });
  return !orderFound && distance(pos, targetPosition) > 16;
}