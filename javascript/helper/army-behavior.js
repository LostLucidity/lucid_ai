//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("./location");
const { tankBehavior } = require("./unit-behavior");

module.exports = {
  attack: (resources, mainCombatTypes, supportUnitTypes) => {
    const {
      map,
      units
    } = resources.get();
    const collectedActions = [];
    // closest enemy base
    let [ closestEnemyBase ] = units.getClosest(getCombatRally(map, units), units.getBases(Alliance.ENEMY), 1);
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    let [ closestEnemyUnit ] = units.getClosest(getCombatRally(map, units), enemyUnits, 1);
    const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
    if (closestEnemyBase || closestEnemyUnit) {
      const enemyTarget = closestEnemyBase || closestEnemyUnit;
      // const [ combatPoint ] = getClosestByPath(map, enemyTarget.pos, combatUnits, 1);
      const [ combatPoint ] = units.getClosest(enemyTarget.pos, combatUnits, 1);
      if (combatPoint) {
        collectedActions.push(...attackWithArmy(combatPoint, units, combatUnits, supportUnits, enemyTarget));
      }
    } else {
      // order to location,
      const expansions = map.getAvailableExpansions().concat(map.getEnemyMain());
      const idleCombatUnits = units.getCombatUnits().filter(u => u.noQueue);
      const randomExpansion = expansions[Math.floor(Math.random() * expansions.length)];
      const randomPosition = randomExpansion ? randomExpansion.townhallPosition : getRandomPoint(map)
      if (randomPosition) {
        const [ combatPoint ] = units.getClosest(randomPosition, combatUnits, 1);
        if (combatPoint) {
          if (supportUnits.length > 1) {
            const supportUnitTags = supportUnits.map(unit => unit.tag);
            let unitCommand = {
              abilityId: MOVE,
              targetWorldSpacePos: combatPoint.pos,
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
    }
    return collectedActions;
  },
  defend: (resources, mainCombatTypes, supportUnitTypes) => {
    const {
      map,
      units,
    } = resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    // let [ closestEnemyUnit ] = getClosestByPath(map, map.getCombatRally(), enemyUnits, 1);
    const rallyPoint = getCombatRally(map, units);
    if (rallyPoint) {
      let [ closestEnemyUnit ] = units.getClosest(rallyPoint, enemyUnits, 1);
      const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
      if (closestEnemyUnit) {
        if (closestEnemyUnit.isFlying) {
          // if no anti air in combat, use Queens.
          const findAntiAir = combatUnits.find(unit => unit.canShootUp());
          if (!findAntiAir) {
            supportUnits.push(...units.getById(QUEEN));
          }
        }
        // const [ combatPoint ] = getClosestByPath(map, closestEnemyUnit.pos, combatUnits, 1);
        const [ combatPoint ] = units.getClosest(closestEnemyUnit.pos, combatUnits, 1);
        if (combatPoint) {
          collectedActions.push(...attackWithArmy(combatPoint, units, combatUnits, supportUnits, closestEnemyUnit));
        }
      }
    }
    return collectedActions;
  }
};

function groupUnits(units, mainCombatTypes, supportUnitTypes) {
  const combatUnits = [];
  mainCombatTypes.forEach(type => {
    combatUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout')));
  });
  const supportUnits = [];
  supportUnitTypes.forEach(type => {
    supportUnits.push(...units.getById(type).filter(unit => !unit.labels.get('scout')));
  });
  return [ combatUnits, supportUnits ];
}

function attackWithArmy(combatPoint, units, combatUnits, supportUnits, enemyTarget) {
  const collectedActions = [];
  const pointType = combatPoint.unitType;
  const pointTypeUnits = units.getById(pointType);
  const nonPointTypeUnits = combatUnits.filter(unit => !(unit.unitType === pointType));
  const nonPointTypeUnitTags = nonPointTypeUnits.map(unit => unit.tag);
  let unitCommand = {
    abilityId: ATTACK_ATTACK,
    targetWorldSpacePos: combatPoint.pos,
    unitTags: [ ...nonPointTypeUnitTags ],
  }
  collectedActions.push(unitCommand);
  if (supportUnits.length > 0) {
    const supportUnitTags = supportUnits.map(unit => unit.tag);
    let unitCommand = {
      abilityId: MOVE,
      targetWorldSpacePos: combatPoint.pos,
      unitTags: [ ...supportUnitTags ],
    }
    collectedActions.push(unitCommand);
  }
  const changelings = [14, 15, 16];
  const pointTypeUnitTags = pointTypeUnits.map(unit => unit.tag);
  if (changelings.includes(enemyTarget.unitType)) {
    const killChanglingCommand = {
      abilityId: ATTACK,
      targetUnitTag: enemyTarget.tag,
      unitTags: [ ...pointTypeUnitTags ],
    }
    collectedActions.push(killChanglingCommand);
  } else {
    unitCommand = {
      abilityId: ATTACK_ATTACK,
      targetWorldSpacePos: enemyTarget.pos,
      unitTags: [ ...pointTypeUnitTags ],
    }
    collectedActions.push(unitCommand);
  }
  collectedActions.push(...tankBehavior(units));
  return collectedActions;
}
