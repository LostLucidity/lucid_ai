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
const { getInRangeUnits, calculateNearSupply } = require("../battle-analysis");
const { filterLabels } = require("../unit-selection");
const { scanCloakedEnemy } = require("../terran");
const { workerTypes } = require("@node-sc2/core/constants/groups");

module.exports = {
  attack: ({data, resources}, mainCombatTypes, supportUnitTypes) => {
    const {
      map,
      units
    } = resources.get();
    const collectedActions = [];
    let [ closestEnemyBase ] = getClosestUnitByPath(resources, getCombatRally(resources), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    const avgCombatUnitsPoint = avgPoints(combatUnits.map(unit => unit.pos));
    let [ closestEnemyUnit ] = units.getClosest(avgCombatUnitsPoint, enemyUnits, 1);
    if (closestEnemyBase || closestEnemyUnit) {
      const enemyTarget = closestEnemyBase || closestEnemyUnit;
      const combatPoint = getCombatPoint(resources, combatUnits, enemyTarget);
      if (combatPoint) {
        const army = { combatPoint, combatUnits, supportUnits, enemyTarget}
        collectedActions.push(...attackWithArmy(data, units, army));
      }
      collectedActions.push(...scanCloakedEnemy( units, enemyTarget, combatUnits));
    } else {
      // order to location,
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
            unitTags: [ ...supportUnitTags ],
          }
          collectedActions.push(unitCommand);
        }
        const idleCombatUnitTags = idleCombatUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: ATTACK_ATTACK,
          targetWorldSpacePos: randomPosition,
          unitTags: [ ...idleCombatUnitTags ],
        }
        collectedActions.push(unitCommand);

      }
    }
    return collectedActions;
  },
  defend: async (world, assemblePlan, mainCombatTypes, supportUnitTypes, threats) => {
    const { data, resources } = world;
    const { units } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getCombatUnits(Alliance.ENEMY);
    const rallyPoint = getCombatRally(resources);
    if (rallyPoint) {
      let [ closestEnemyUnit ] = getClosestUnitByPath(resources, rallyPoint, threats);
      if (closestEnemyUnit) {
        const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        collectedActions.push(...scanCloakedEnemy(units, closestEnemyUnit, combatUnits));
        const [ combatPoint ] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
        if (combatPoint) {
          const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          let allyUnits = [ ...combatUnits, ...supportUnits ];
          const selfSupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          if (selfSupply > enemySupply) {
            console.log('Defend', selfSupply, enemySupply);
            if (closestEnemyUnit.isFlying) {
              const findAntiAir = combatUnits.find(unit => unit.canShootUp());
              if (!findAntiAir) {
                combatUnits.push(...units.getById(QUEEN));
              }
            }
            const combatPoint = getCombatPoint(resources, combatUnits, closestEnemyUnit);
            if (combatPoint) {
              const army = { combatPoint, combatUnits, supportUnits, enemyTarget: closestEnemyUnit}
              collectedActions.push(...attackWithArmy(data, units, army));
            }
          } else {
            console.log('building defensive units');
            await continuouslyBuild(world, assemblePlan, mainCombatTypes);
            if (selfSupply < enemySupply) {
              console.log('engageOrRetreat', selfSupply, enemySupply);
              allyUnits = [...allyUnits, ...units.getById(QUEEN), ...units.getWorkers()];
              collectedActions.push(...module.exports.engageOrRetreat(world, allyUnits, enemyUnits, rallyPoint));
            }
          }
        }
      }
    }
    return collectedActions;
  },
  getInRangeDestructables: (units, selfUnit) => {
    let tag = null;
    const ROCKS = [ 373, 638, 639, 640, 643 ];
    const DEBRIS = [ 364, 365, 376 ];
    const destructableRockTypes = [ ...DEBRIS, ...ROCKS];
    const destructableRockUnits = units.getAlive(Alliance.NEUTRAL).filter(unit => destructableRockTypes.includes(unit.unitType));
    const [ closestDestructable ] = units.getClosest(selfUnit.pos, destructableRockUnits).filter(destructableRockUnit => distance(selfUnit.pos, destructableRockUnit.pos) < 16);
    if (closestDestructable) {
      tag = closestDestructable.tag;
    }
    return tag;
  },
  engageOrRetreat: ({ data, resources}, selfUnits, enemyUnits, position) => {
    const { units } = resources.get();
    const collectedActions = [];
    selfUnits.forEach(selfUnit => {
      let targetPosition = position;
      if (!workerTypes.includes(selfUnit.unitType)) {
        const [ closestEnemyUnit ] = units.getClosest(selfUnit.pos, enemyUnits).filter(enemyUnit => distance(selfUnit.pos, enemyUnit.pos) < 16);
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
              targetWorldSpacePos = retreatToExpansion(resources, selfUnit, closestEnemyUnit)
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
          const unitCommand = {
            abilityId: ATTACK_ATTACK,
            unitTags: [ selfUnit.tag ],
          }
          const destructableTag = module.exports.getInRangeDestructables(units, selfUnit);
          if (destructableTag) { unitCommand.targetUnitTag = destructableTag; }
          else { unitCommand.targetWorldSpacePos = targetPosition; }
          collectedActions.push(unitCommand);
        }
      }
    });
    return collectedActions;
  }
};

function getCombatPoint(resources, units, target) {
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
      [ closestUnit ] = getClosestUnitByPath(resources, target.pos, units);
      closestUnit.labels.set(label, true);
    } catch(e) {
      [ closestUnit ] = resources.get().units.getClosest(target.pos, units)
    }
    return closestUnit;
  }
}

function groupUnits(units, mainCombatTypes, supportUnitTypes) {
  const combatUnits = [];
  mainCombatTypes.forEach(type => {
    combatUnits.push(...units.getById(type).filter(unit => filterLabels(unit, ['scout', 'harasser'])));
  });
  const supportUnits = [];
  supportUnitTypes.forEach(type => {
    supportUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout') && !unit.labels.get('creeper') && !unit.labels.get('injector')));
  });
  return [ combatUnits, supportUnits ];
}

function attackWithArmy(data, units, army) {
  const collectedActions = [];
  const pointType = army.combatPoint.unitType;
  const pointTypeUnits = units.getById(pointType);
  const nonPointTypeUnits = army.combatUnits.filter(unit => !(unit.unitType === pointType));
  const pointTypeUnitTags = pointTypeUnits.map(unit => unit.tag);
  const nonPointTypeUnitTags = nonPointTypeUnits.map(unit => unit.tag);
  const range = Math.max.apply(Math, data.getUnitTypeData(SIEGETANKSIEGED).weapons.map(weapon => { return weapon.range; }))
  const targetWorldSpacePos = distance(army.combatPoint.pos, army.enemyTarget.pos) > range ? army.combatPoint.pos : army.enemyTarget.pos;
  let unitCommand = {
    abilityId: ATTACK_ATTACK,
    targetWorldSpacePos: targetWorldSpacePos,
    unitTags: [ ...pointTypeUnitTags, ...nonPointTypeUnitTags ],
  }
  collectedActions.push(unitCommand);
  if (army.supportUnits.length > 0) {
    const supportUnitTags = army.supportUnits.map(unit => unit.tag);
    let unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: army.combatPoint.pos,
      unitTags: [ ...supportUnitTags ],
    }
    collectedActions.push(unitCommand);
  }
  const changelings = [13, 14, 15, 16];
  if (changelings.includes(army.enemyTarget.unitType)) {
    const killChanglingCommand = {
      abilityId: ATTACK,
      targetUnitTag: army.enemyTarget.tag,
      unitTags: [ ...pointTypeUnitTags ],
    }
    collectedActions.push(killChanglingCommand);
  } else {
    unitCommand = {
      abilityId: ATTACK_ATTACK,
      targetWorldSpacePos: army.enemyTarget.pos,
      unitTags: [ army.combatPoint.tag ],
    }
    collectedActions.push(unitCommand);
  }
  collectedActions.push(...tankBehavior(units));
  return collectedActions;
}