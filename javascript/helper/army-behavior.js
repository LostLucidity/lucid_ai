//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN, ORBITALCOMMAND } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK, EFFECT_SCAN } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("./location");
const { tankBehavior } = require("./unit-behavior");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");
const continuouslyBuild = require("./continuously-build");
const { moveAwayPosition, retreatToExpansion } = require("../builds/helper");
const { getClosestUnitByPath } = require("./get-closest-by-path");
const { filterLabels } = require("./unit-selection");

module.exports = {
  attack: ({data, resources}, mainCombatTypes, supportUnitTypes) => {
    const {
      map,
      units
    } = resources.get();
    const collectedActions = [];
    // closest enemy base
    let [ closestEnemyBase ] = getClosestUnitByPath(resources, getCombatRally(map, units), units.getBases(Alliance.ENEMY), 1);
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
      collectedActions.push(...scanCloakedEnemy(data, units, enemyTarget, combatUnits));
      if (combatPoint && map.hasCreep(combatPoint.pos)) {
        const position = combatPoint.pos;
        const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
        if (position && orbitalCommand) {
          const unitCommand = {
            abilityId: EFFECT_SCAN,
            targetWorldSpacePos: position,
            unitTags: [ orbitalCommand.tag ],
          }
          collectedActions.push(unitCommand);
        }
      }
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
  defend: async (world, mainCombatTypes, supportUnitTypes, threats) => {
    const data = world.data;
    const resources = world.resources;
    const {
      map,
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getCombatUnits(Alliance.ENEMY);
    const rallyPoint = getCombatRally(map, units);
    if (rallyPoint) {
      let [ closestEnemyUnit ] = getClosestUnitByPath(resources, rallyPoint, threats, 1);
      if (closestEnemyUnit) {
        const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        collectedActions.push(...scanCloakedEnemy(data, units, closestEnemyUnit, combatUnits));
        const [ combatPoint ] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
        if (combatPoint) {
          const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          let allyUnits = [ ...combatUnits, ...supportUnits ];
          const selfSupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          if (selfSupply > enemySupply) {
            console.log('Defend', selfSupply, enemySupply);
            if (closestEnemyUnit.isFlying) {
              // if no anti air in combat, use Queens.
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
            await continuouslyBuild(world, mainCombatTypes);
            if (selfSupply < enemySupply) {
              console.log('engageOrRetreat', selfSupply, enemySupply);
              allyUnits = [...allyUnits, ...units.getById(QUEEN)];
              collectedActions.push(...module.exports.engageOrRetreat(world, units, allyUnits, enemyUnits));
            }
          }
        }
      }
    }
    return collectedActions;
  },
  engageOrRetreat: ({ data, resources}, units, selfUnits, enemyUnits, position) => {
    const collectedActions = [];
    selfUnits.forEach(selfUnit => {
      const [ closestEnemyUnit ] = units.getClosest(selfUnit.pos, enemyUnits).filter(enemyUnit => distance(selfUnit.pos, enemyUnit.pos) < 8);
      if (closestEnemyUnit) {
        const positionIsTooClose = position ? distance(selfUnit.pos, position) < 8 : false;
        closestEnemyUnit.inRangeUnits = enemyUnits.filter(enemyUnit => distance(closestEnemyUnit.pos, enemyUnit.pos) < 8);
        const enemySupply = closestEnemyUnit.inRangeUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        const inRangeSelfUnits = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) < 8)
        selfUnit.selfSupply = inRangeSelfUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        const noBunker = units.getById(BUNKER).length === 0;
        if (enemySupply > selfUnit.selfSupply && noBunker) {
          let targetWorldSpacePos = position;
          if (!position || positionIsTooClose) {
            const isFlying = selfUnit.isFlying;
            if (isFlying) {
              targetWorldSpacePos = moveAwayPosition(closestEnemyUnit, selfUnit);
            } else {
              targetWorldSpacePos = retreatToExpansion(resources, selfUnit, closestEnemyUnit)
            }
          }
          const unitCommand = {
            abilityId: MOVE,
            targetWorldSpacePos: targetWorldSpacePos,
            unitTags: [selfUnit.tag],
          }
          collectedActions.push(unitCommand);
        } else {
          const unitCommand = {
            abilityId: ATTACK_ATTACK,
            targetUnitTag: closestEnemyUnit.tag,
            unitTags: [selfUnit.tag],
          }
          collectedActions.push(unitCommand);
        } 
      } else {
        if (position) {
          const unitCommand = {
            abilityId: ATTACK_ATTACK,
            targetWorldSpacePos: position,
            unitTags: [ selfUnit.tag ],
          }
          collectedActions.push(unitCommand);
        }
      }
    });
    return collectedActions;
  }
};

function filterLabels(unit, labels) {
  return labels.every(label => !unit.labels.get(label))
}

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
    const closestUnit = getClosestUnitByPath(resources, target.pos, units, 1)[0];
    closestUnit.labels.set(label, true);
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
  const range = Math.max.apply(Math, data.getUnitTypeData(32).weapons.map(weapon => { return weapon.range; }))
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

function scanCloakedEnemy(data, units, target, selfUnits) {
  const collectedActions = []
  if (target.cloak === 1) {
    let position = null;
    if (target.cloak === 1) {
      const [ closestToCloak ] = units.getClosest(target.pos, selfUnits);
      if (distance(closestToCloak.pos, target.pos) < 8) {
        position = target.pos;
      }
      const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
      if (position && orbitalCommand) {
        const unitCommand = {
          abilityId: EFFECT_SCAN,
          targetWorldSpacePos: position,
          unitTags: [ orbitalCommand.tag ],
        }
        collectedActions.push(unitCommand);
      }
    }
  }
  return collectedActions;
}
