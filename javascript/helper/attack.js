//@ts-check

const { Alliance } = require("@node-sc2/core/constants/enums");
const { LARVA, OBSERVER, WARPPRISM } = require("@node-sc2/core/constants/unit-type");
const { MOVE, ATTACK_ATTACK, ATTACK } = require("@node-sc2/core/constants/ability");


function attack(resources) {
  const {
    map,
    units
  } = resources.get();
  const collectedActions = [];
  // attack when near maxed.
  const combatUnits = units.getCombatUnits();
  // closest enemy base
  let [ closestEnemyBase ] = units.getClosest(map.getCombatRally(), units.getBases(Alliance.ENEMY), 1);
  const enemyUnits = units.getAlive(Alliance.ENEMY).filter(unit => !(unit.unitType === LARVA));
  let [ closestEnemyUnit ] = units.getClosest(map.getCombatRally(), enemyUnits, 1);
  const supportUnits = units.getById(OBSERVER).concat(...units.getById(WARPPRISM));
  if (closestEnemyBase || closestEnemyUnit) {
    const enemyTarget = closestEnemyBase || closestEnemyUnit;
    const [ combatPoint ] = units.getClosest(enemyTarget.pos, combatUnits, 1);
    if (combatPoint) {
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
      if (supportUnits.length > 1) {
        const supportUnitTags = supportUnits.map(unit => unit.tag);
        let unitCommand = {
          abilityId: MOVE,
          targetWorldSpacePos: combatPoint.pos,
          unitTags: [ ...supportUnitTags ],
        }
        collectedActions.push(unitCommand);
      }
      let ability = ATTACK_ATTACK
      if (enemyTarget.unitType === 16) {
        ability = ATTACK
      }
      const pointTypeUnitTags = pointTypeUnits.map(unit => unit.tag);
      unitCommand = {
        abilityId: ATTACK,
        targetWorldSpacePos: enemyTarget.pos,
        unitTags: [ ...pointTypeUnitTags ],
      }
      collectedActions.push(unitCommand);
    }
  } else {
    // order to location, 
    const expansions = map.getAvailableExpansions().concat(map.getEnemyMain());
    const idleCombatUnits = units.getCombatUnits().filter(u => u.noQueue);
    const randomExpansion = expansions[Math.floor(Math.random() * expansions.length)];
    const [ combatPoint ] = units.getClosest(randomExpansion.townhallPosition, combatUnits, 1);
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
      targetWorldSpacePos: randomExpansion.townhallPosition,
      unitTags: [ ...idleCombatUnitTags ],
    }
    collectedActions.push(unitCommand);
  }
  return collectedActions;
}

module.exports = attack;