//@ts-check
"use strict"

const { ATTACK_ATTACK, MOVE, ATTACK, HARVEST_GATHER } = require("@node-sc2/core/constants/ability");
const { workerTypes, mineralFieldTypes } = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { SIEGETANKSIEGED, BUNKER, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { moveAwayPosition, retreatToExpansion } = require("../builds/helper");
const { getInRangeUnits, calculateNearSupply, getInRangeDestructables, calculateHealthAdjustedSupply } = require("../helper/battle-analysis");
const { tankBehavior } = require("../helper/behavior/unit-behavior");
const { getClosestUnitByPath } = require("../helper/get-closest-by-path");
const { filterLabels } = require("../helper/unit-selection");
const { mappedEnemyUnits } = require("../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine } = require("../systems/manage-resources");
const { micro } = require("./micro-service");
const { isRepairing } = require("./units-service");

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
  engageOrRetreat: ({ data, resources }, selfUnits, enemyUnits, position, clearRocks = true) => {
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
              targetWorldSpacePos = retreatToExpansion(resources, selfUnit, closestEnemyUnit);
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
            selfUnit.labels.set('retreat', false);
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
            else { unitCommand.targetWorldSpacePos = targetPosition; }
            collectedActions.push(unitCommand);
          }
        }
      }
    });
    return collectedActions;
  },
  getCombatPoint: (resources, units, target) => {
    const label = 'combatPoint';
    const combatPoint = units.find(unit => unit.labels.get(label));
    if (combatPoint) {
      let sameTarget = false;
      if (combatPoint.orders[0]) {
        const filteredOrder = combatPoint.orders.filter(order => !!order.targetWorldSpacePos)[0];
        sameTarget = filteredOrder && (Math.round(filteredOrder.targetWorldSpacePos.x * 2) / 2) === target.pos.x && (Math.round(filteredOrder.targetWorldSpacePos.y * 2) / 2) === target.pos.y;
      }
      const newTarget = combatPoint.orders[0] && combatPoint.orders[0].targetWorldSpacePos && combatPoint.orders[0].targetWorldSpacePos.x === target.pos.x && combatPoint.orders[0].targetWorldSpacePos.y === target.pos.y;
      if (sameTarget) {
        return combatPoint;
      } else {
        combatPoint.labels.set(label, false);
      }
    } else {
      let closestUnit;
      try {
        [closestUnit] = getClosestUnitByPath(resources, target.pos, units);
        closestUnit.labels.set(label, true);
      } catch (e) {
        [closestUnit] = resources.get().units.getClosest(target.pos, units)
      }
      return closestUnit;
    }
  },
  pullWorkersToDefend: async ({ agent, data, resources }, worker, targetUnit, enemyUnits) => {
    const { units } = resources.get();
    const collectedActions = [];
    const inRangeEnemySupply = calculateHealthAdjustedSupply(data, getInRangeUnits(targetUnit, mappedEnemyUnits));
    const amountToFightWith = Math.ceil(inRangeEnemySupply / data.getUnitTypeData(WorkerRace[agent.race]).foodRequired);
    const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));
    const fighters = units.getClosest(targetUnit.pos, workers.filter(worker => !worker.isReturning() && !worker.isConstructing()), amountToFightWith);
    if (fighters.find(fighter => fighter.tag === worker.tag)) {
      const candidateMinerals = units.getByType(mineralFieldTypes).filter(mineralField => distance(worker.pos, mineralField.pos) < distance(targetUnit.pos, mineralField.pos));
      const [closestCandidateMineral] = units.getClosest(worker.pos, candidateMinerals);
      const retreatCommand = {
        abilityId: HARVEST_GATHER,
        targetUnitTag: closestCandidateMineral.tag,
        unitTags: [worker.tag],
        queueCommand: false,
      }
      collectedActions.push(...micro(worker, targetUnit, enemyUnits, retreatCommand));
    } else if (worker.isAttacking() && worker.orders.find(order => order.abilityId === ATTACK_ATTACK).targetUnitTag === targetUnit.tag) {
      await gatherOrMine(resources, worker);
    }
    return collectedActions;
  }
}

module.exports = armyManagementService;
