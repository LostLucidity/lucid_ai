//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN, BUNKER, SIEGETANKSIEGED } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("../location");
const { tankBehavior } = require("./unit-behavior");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const continuouslyBuild = require("../continuously-build");
const { moveAwayPosition, retreatToExpansion } = require("../../builds/helper");
const { getClosestUnitByPath } = require("../get-closest-by-path");
const { filterLabels } = require("../unit-selection");
const { scanCloakedEnemy } = require("../terran");
const { workerTypes } = require("@node-sc2/core/constants/groups");
const { microRangedUnit } = require("../../services/micro-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const { setPendingOrders, getSupply } = require("../../helper");
const { pullWorkersToDefend } = require("../../services/army-management-service");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { isRepairing } = require("../../services/units-service");

module.exports = {
  attack: ({ data, resources }, mainCombatTypes, supportUnitTypes) => {
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [closestEnemyUnit] = units.getClosest(avgCombatUnitsPoint, enemyUnits, 1);
    if (closestEnemyBase || closestEnemyUnit) {
      const enemyTarget = closestEnemyBase || closestEnemyUnit;
      const combatPoint = module.exports.getCombatPoint(resources, combatUnits, enemyTarget);
      if (combatPoint) {
        const army = { combatPoint, combatUnits, supportUnits, enemyTarget }
        collectedActions.push(...module.exports.attackWithArmy({ data, resources }, army, enemyUnits));
      }
      collectedActions.push(...scanCloakedEnemy(units, enemyTarget, combatUnits));
    } else {
      collectedActions.push(...module.exports.searchAndDestroy(resources, combatUnits, supportUnits));
    }
    return collectedActions;
  },
  defend: async (world, assemblePlan, mainCombatTypes, supportUnitTypes, threats) => {
    const { agent, data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY);
    const rallyPoint = getCombatRally(resources);
    if (rallyPoint) {
      let [closestEnemyUnit] = getClosestUnitByPath(resources, rallyPoint, threats);
      if (closestEnemyUnit) {
        const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
        const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
        const workers = units.getById(WorkerRace[agent.race]).filter(unit => filterLabels(unit, ['scoutEnemyMain', 'scoutEnemyNatural', 'clearFromEnemy']) && !isRepairing(unit));
        if (combatPoint) {
          const enemySupply = getSupply(data, enemyUnits);
          let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
          const selfSupply = getSupply(data, allyUnits);
          if (selfSupply > enemySupply) {
            console.log('Defend', selfSupply, enemySupply);
            if (closestEnemyUnit.isFlying) {
              const findAntiAir = combatUnits.find(unit => unit.canShootUp());
              if (!findAntiAir) {
                combatUnits.push(...units.getById(QUEEN));
              }
            }
            const combatPoint = module.exports.getCombatPoint(resources, combatUnits, closestEnemyUnit);
            if (combatPoint) {
              const army = { combatPoint, combatUnits, supportUnits, enemyTarget: closestEnemyUnit }
              collectedActions.push(...module.exports.attackWithArmy(world, army, enemyUnits));
            }
          } else {
            console.log('building defensive units');
            await continuouslyBuild(world, assemblePlan, mainCombatTypes);
            if (selfSupply < enemySupply) {
              console.log('engageOrRetreatVisible', selfSupply, enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0));
              console.log('engageOrRetreatMapped', selfSupply, enemyTrackingService.mappedEnemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0));
              for (const worker of workers) { collectedActions.push(...await pullWorkersToDefend({ agent, data, resources }, worker, closestEnemyUnit, enemyUnits)); }
              allyUnits = [...allyUnits, ...units.getById(QUEEN)];
              collectedActions.push(...module.exports.engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));
            }
          }
        } else {
          for (const worker of workers) { collectedActions.push(...await pullWorkersToDefend({ agent, data, resources }, worker, closestEnemyUnit, enemyUnits)); }
        }
      }
    }
    return collectedActions;
  },
  getInRangeDestructables: (units, selfUnit) => {
    let tag = null;
    const ROCKS = [373, 638, 639, 640, 643];
    const DEBRIS = [364, 365, 376];
    const destructableRockTypes = [...DEBRIS, ...ROCKS];
    const destructableRockUnits = units.getAlive(Alliance.NEUTRAL).filter(unit => destructableRockTypes.includes(unit.unitType));
    const [closestDestructable] = units.getClosest(selfUnit.pos, destructableRockUnits).filter(destructableRockUnit => distance(selfUnit.pos, destructableRockUnit.pos) < 16);
    if (closestDestructable) {
      tag = closestDestructable.tag;
    }
    return tag;
  },
  engageOrRetreat: ({ data, resources }, selfUnits, enemyUnits, position, clearRocks = true) => {
    const { units } = resources.get();
    const collectedActions = [];
    selfUnits.forEach(selfUnit => {
      let targetPosition = position;
      if (!workerTypes.includes(selfUnit.unitType)) {
        const [closestEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits);
        if (closestEnemyUnit && distance(selfUnit.pos, closestEnemyUnit.pos) < 16) {
          const selfDPSHealth = selfUnit.selfDPSHealth > closestEnemyUnit.enemyDPSHealth ? selfUnit.selfDPSHealth : closestEnemyUnit.enemyDPSHealth;
          const noBunker = units.getById(BUNKER).length === 0;
          if (closestEnemyUnit.selfDPSHealth > selfDPSHealth && noBunker) {
            const isFlying = selfUnit.isFlying;
            const unitCommand = { abilityId: MOVE }
            if (isFlying) {
              unitCommand.targetWorldSpacePos = moveAwayPosition(closestEnemyUnit, selfUnit);
              unitCommand.unitTags = [selfUnit.tag];
              collectedActions.push(unitCommand);
            } else {
              if (selfUnit.pendingOrders === undefined || selfUnit.pendingOrders.length === 0) {
                const [closestArmedEnemyUnit] = units.getClosest(selfUnit.pos, enemyUnits.filter(unit => unit.data().weapons.some(w => w.range > 0)));
                unitCommand.targetWorldSpacePos = retreatToExpansion(resources, selfUnit, closestArmedEnemyUnit);
                unitCommand.unitTags = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) <= 1).map(unit => {
                  setPendingOrders(unit, unitCommand);
                  return unit.tag;
                });
                collectedActions.push(unitCommand);
              }
            }
          } else {
            if (!selfUnit.isMelee()) { collectedActions.push(...microRangedUnit(data, selfUnit, closestEnemyUnit)); }
            else {
              selfUnit.labels.set('retreat', false);
              collectedActions.push({
                abilityId: ATTACK_ATTACK,
                targetUnitTag: closestEnemyUnit.tag,
                unitTags: [selfUnit.tag],
              });
            }
          }
        } else {
          if (selfUnit.unitType !== QUEEN) {
            const unitCommand = {
              abilityId: ATTACK_ATTACK,
              unitTags: [selfUnit.tag],
            }
            const destructableTag = module.exports.getInRangeDestructables(units, selfUnit);
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
  attackWithArmy: ({ data, resources }, army, enemyUnits) => {
    const { units } = resources.get();
    const collectedActions = [];
    const pointType = army.combatPoint.unitType;
    const pointTypeUnits = units.getById(pointType);
    const nonPointTypeUnits = army.combatUnits.filter(unit => !(unit.unitType === pointType));
    const pointTypeUnitTags = pointTypeUnits.map(unit => unit.tag);
    const range = Math.max.apply(Math, data.getUnitTypeData(SIEGETANKSIEGED).weapons.map(weapon => { return weapon.range; }));
    const targetWorldSpacePos = distance(army.combatPoint.pos, army.enemyTarget.pos) > range ? army.combatPoint.pos : army.enemyTarget.pos;
    [...pointTypeUnits, ...nonPointTypeUnits].forEach(unit => {
      const [closestUnit] = units.getClosest(unit.pos, enemyUnits.filter(enemyUnit => distance(unit.pos, enemyUnit.pos) < 16));
      if (!unit.isMelee() && closestUnit) { collectedActions.push(...microRangedUnit(data, unit, closestUnit)); }
      else {
        collectedActions.push({
          abilityId: ATTACK_ATTACK,
          targetWorldSpacePos: targetWorldSpacePos,
          unitTags: [unit.tag],
        })
      }
    });
    if (army.supportUnits.length > 0) {
      const supportUnitTags = army.supportUnits.map(unit => unit.tag);
      let unitCommand = {
        abilityId: MOVE,
        targetWorldSpacePos: army.combatPoint.pos,
        unitTags: [...supportUnitTags],
      }
      collectedActions.push(unitCommand);
    }
    const changelings = [13, 14, 15, 16];
    if (changelings.includes(army.enemyTarget.unitType)) {
      const killChanglingCommand = {
        abilityId: ATTACK,
        targetUnitTag: army.enemyTarget.tag,
        unitTags: [...pointTypeUnitTags],
      }
      collectedActions.push(killChanglingCommand);
    } else {
      collectedActions.push({
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: army.enemyTarget.pos,
        unitTags: [army.combatPoint.tag],
      });
    }
    collectedActions.push(...tankBehavior(units));
    return collectedActions;
  },
  push: async (world, mainCombatTypes, supportUnitTypes) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    let [closestEnemyBase] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [closestEnemyUnit] = getClosestUnitByPath(resources, avgCombatUnitsPoint, enemyUnits, 1);
    const closestEnemyTarget = closestEnemyBase || closestEnemyUnit;
    if (closestEnemyTarget) {
      const [combatUnits, supportUnits] = groupUnits(units, mainCombatTypes, supportUnitTypes);
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
      const [combatPoint] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
      if (combatPoint) {
        const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        let allyUnits = [...combatUnits, ...supportUnits, ...units.getWorkers().filter(worker => worker.isAttacking())];
        const selfSupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        console.log('Push', selfSupply, enemySupply);
        collectedActions.push(...module.exports.engageOrRetreat(world, allyUnits, enemyUnits, closestEnemyTarget.pos, false));
      }
      collectedActions.push(...scanCloakedEnemy(units, closestEnemyTarget, combatUnits));
    } else {
      collectedActions.push(...module.exports.searchAndDestroy(resources, combatUnits, supportUnits));
    }
    return collectedActions;
  },
  searchAndDestroy: (resources, combatUnits, supportUnits) => {
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'combatPoint';
    const combatPoint = combatUnits.find(unit => unit.labels.get(label));
    if (combatPoint) { combatPoint.labels.set(label, false); }
    const expansions = [...map.getAvailableExpansions(), ...map.getOccupiedExpansions(4)];
    const idleCombatUnits = units.getCombatUnits().filter(u => u.noQueue);
    const randomExpansion = expansions[Math.floor(Math.random() * expansions.length)];
    const randomPosition = randomExpansion ? randomExpansion.townhallPosition : getRandomPoint(map)
    if (randomPosition) {
      if (supportUnits.length > 1) {
        const supportUnitTags = supportUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: randomPosition,
          unitTags: [...supportUnitTags],
        }
        collectedActions.push(unitCommand);
      }
      const idleCombatUnitTags = idleCombatUnits.map(unit => unit.tag);
      let unitCommand = {
        abilityId: ATTACK_ATTACK,
        targetWorldSpacePos: randomPosition,
        unitTags: [...idleCombatUnitTags],
      }
      collectedActions.push(unitCommand);
    }
    return collectedActions;
  }
};

function groupUnits(units, mainCombatTypes, supportUnitTypes) {
  const combatUnits = [];
  mainCombatTypes.forEach(type => {
    combatUnits.push(...units.getById(type).filter(unit => filterLabels(unit, ['scout', 'harasser'])));
  });
  const supportUnits = [];
  supportUnitTypes.forEach(type => {
    supportUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')));
  });
  return [combatUnits, supportUnits];
}
