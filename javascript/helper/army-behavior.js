//@ts-check
"use strict"

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, QUEEN, ORBITALCOMMAND } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK, EFFECT_SCAN } = require("@node-sc2/core/constants/ability");
const { getRandomPoint, getCombatRally } = require("./location");
const { tankBehavior } = require("./unit-behavior");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const continuouslyBuild = require("./continuously-build");
const { moveAwayPosition, retreatToExpansion } = require("../builds/helper");
const { getClosestUnitByPath } = require("./get-closest-by-path");

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
      if (enemyTarget.cloak === 1) {
        const orbitalCommand = units.getById(ORBITALCOMMAND).find(n => n.energy > 50);
        if (orbitalCommand) {
          const unitCommand = {
            abilityId: EFFECT_SCAN,
            targetWorldSpacePos: closestEnemyUnit.pos,
            unitTags: [ orbitalCommand.tag ],
          }
          collectedActions.push(unitCommand);
        }
      }
      const [ combatPoint ] = getClosestUnitByPath(resources, enemyTarget.pos, combatUnits, 1);
      if (combatPoint) {
        collectedActions.push(...attackWithArmy(combatPoint, units, combatUnits, supportUnits, enemyTarget));
      }
    } else {
      // order to location,
      const expansions = [...map.getAvailableExpansions(), ...map.getOccupiedExpansions(4)];
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
  defend: async (world, mainCombatTypes, supportUnitTypes) => {
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
      let [ closestEnemyUnit ] = getClosestUnitByPath(resources, rallyPoint, enemyUnits, 1);
      if (closestEnemyUnit) {
        const [ combatUnits, supportUnits ] = groupUnits(units, mainCombatTypes, supportUnitTypes);
        const [ combatPoint ] = getClosestUnitByPath(resources, closestEnemyUnit.pos, combatUnits, 1);
        if (combatPoint) {
          const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          let allyUnits = [ ...combatUnits, ...supportUnits ];
          const selfSupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0)
          if ((selfSupply <= enemySupply)) {
            console.log('building defensive units');
            await continuouslyBuild(world, mainCombatTypes);
          }
          if (selfSupply >= enemySupply) {
            console.log('Defend', selfSupply, enemySupply);
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
            console.log('engageOrRetreat', selfSupply, enemySupply);
            allyUnits = [...allyUnits, ...units.getById(QUEEN)];
            collectedActions.push(...module.exports.engageOrRetreat(world, units, allyUnits, enemyUnits));
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
        const enemySupply = enemyUnits.filter(enemyUnit => distance(closestEnemyUnit.pos, enemyUnit.pos) < 8).map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        const inRangeSelfUnits = selfUnits.filter(unit => distance(unit.pos, selfUnit.pos) < 8)
        const selfSupply = inRangeSelfUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        if (enemySupply > selfSupply) {
          if (!position || positionIsTooClose) {
            const isFlying = selfUnit.isFlying;
            if (isFlying) {
              position = moveAwayPosition(closestEnemyUnit, selfUnit);
            } else {
              position = retreatToExpansion(resources, selfUnit, closestEnemyUnit)
            }
          }
          const unitCommand = {
            abilityId: MOVE,
            targetWorldSpacePos: position,
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
        const unitCommand = {
          abilityId: ATTACK_ATTACK,
          targetWorldSpacePos: position,
          unitTags: [ selfUnit.tag ],
        }
        collectedActions.push(unitCommand);
      }
    })
    return collectedActions;
  }
};

function filterLabels(unit, labels) {
  return labels.every(label => !unit.labels.get(label))
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
  const changelings = [13, 14, 15, 16];
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
