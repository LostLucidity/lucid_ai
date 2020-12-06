//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("./location");
const { tankBehavior } = require("./unit-behavior");
const { moveAway } = require("../builds/helper");
const getClosestByPath = require("./get-closest-by-path");
const { getClosestUnitByPath } = require("./get-closest-by-path");
const { distance, avgPoints } = require("@node-sc2/core/utils/geometry/point");

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
  defend: (world, mainCombatTypes, supportUnitTypes) => {
    const data = world.data;
    const {
      map,
      units,
    } = world.resources.get();
    const collectedActions = [];
    const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
    // let [ closestEnemyUnit ] = getClosestByPath(map, map.getCombatRally(), enemyUnits, 1);
    const rallyPoint = getCombatRally(map, units);
    if (rallyPoint) {
      let [ closestEnemyUnit ] = units.getClosest(rallyPoint, enemyUnits, 1);
      if (closestEnemyUnit) {
        const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        const [ combatPoint ] = units.getClosest(closestEnemyUnit.pos, combatUnits, 1);
        if (combatPoint) {
          const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          let allyUnits = [ ...combatUnits, ...supportUnits ];
          const allySupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          if (allySupply >= enemySupply) {
            console.log('Defend', allySupply, enemySupply);
            if (closestEnemyUnit.isFlying) {
              // if no anti air in combat, use Queens.
              const findAntiAir = combatUnits.find(unit => unit.canShootUp());
              if (!findAntiAir) {
                combatUnits.push(...units.getById(QUEEN));
              }
            }
            // const [ combatPoint ] = getClosestByPath(map, closestEnemyUnit.pos, combatUnits, 1);
            collectedActions.push(...attackWithArmy(combatPoint, units, combatUnits, supportUnits, closestEnemyUnit));
          } else {
            console.log('Retreat', allySupply, enemySupply);
            allyUnits = [...allyUnits, ...units.getById(QUEEN)];
            collectedActions.push(...module.exports.engageOrRetreat(data, units, allyUnits, enemyUnits));
          }
        }
      }
    }
    return collectedActions;
  },
  engageOrRetreat: (data, units, allyUnits, enemyUnits) => {
    const collectedActions = [];
    allyUnits.forEach(unit => {
      const [ closestEnemyUnit ] = units.getClosest(unit.pos, enemyUnits);
      const enemySupply = enemyUnits.filter(enemyUnit => distance(closestEnemyUnit.pos, enemyUnit.pos) < 8).map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
      const allySupply = allyUnits.filter(allyUnit => distance(unit.pos, allyUnit.pos) < 8).map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
      if (enemySupply > allySupply) {
        const candidateMineralFields = units.getMineralFields().filter(field => distance(field.pos, unit.pos) < distance(field.pos, closestEnemyUnit.pos))
        const [ closestMineralField ] = units.getClosest(unit.pos, candidateMineralFields, candidateMineralFields.length).filter(field => distance(field.pos, closestEnemyUnit.pos) > 16);
        const unitCommand = {
          abilityId: MOVE,
          targetUnitTag: closestMineralField.tag,
          unitTags: [ unit.tag ],
        }
        collectedActions.push(unitCommand);
        // collectedActions.push(moveAway(unit, closestEnemyUnit));
      } else {
        const unitCommand = {
          abilityId: ATTACK_ATTACK,
          targetUnitTag: closestEnemyUnit.tag,
          unitTags: [ unit.tag ],
        }
        collectedActions.push(unitCommand);
      }
    })
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
