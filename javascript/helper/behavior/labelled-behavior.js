//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { PHOTONCANNON, LARVA } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { calculateTotalHealthRatio } = require("../calculate-health");
const { getClosestUnitByPath } = require("../get-closest-by-path");
const { getCombatRally, getRandomPoints, acrossTheMap } = require("../location");
const { engageOrRetreat } = require("./army-behavior");

module.exports = {
  acrossTheMapBehavior: (world) => {
    const { data, resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'acrossTheMap';
    const [ unit ] = units.withLabel(label);
    if (unit) {
      const enemyUnits = units.getAlive(Alliance.ENEMY).filter(enemyUnit => !(unit.unitType === LARVA) && distance(enemyUnit.pos, unit.pos) < 16);
      const enemySupply = enemyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
      const combatUnits = units.getCombatUnits().filter(combatUnit => unit.isAttacking() && distance(combatUnit.pos, unit.pos) < 16);
      let allyUnits = [ unit, ...combatUnits ];
      const selfSupply = allyUnits.map(unit => data.getUnitTypeData(unit.unitType).foodRequired).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
      if (selfSupply < enemySupply) {
        let [ closestEnemyUnit ] = getClosestUnitByPath(resources, unit.pos, enemyUnits, 1);
        collectedActions.push(...engageOrRetreat(world, allyUnits, enemyUnits, closestEnemyUnit.pos, false));
      } else {
        collectedActions.push({
          abilityId: ATTACK_ATTACK,
          unitTags: [ unit.tag ],
          targetWorldSpacePos: acrossTheMap(map),
        });
      }
    }
    return collectedActions;
  },
  clearFromEnemyBehavior: (resources) => {
    const { map, units } = resources.get();
    const label = 'clearFromEnemy';
    const [ unit ] = units.withLabel(label);
    const collectedActions = [];
    if (unit) {
      let [ closestEnemyUnit ] = units.getClosest(unit.pos, units.getAlive(Alliance.ENEMY), 1);
      if (
        !closestEnemyUnit ||
        distance(unit.pos, closestEnemyUnit.pos) > 16 ||
        distance(unit.pos, map.getCombatRally()) < 1
      ) {
        unit.labels.clear();
        console.log('clear!');
      }
      collectedActions.push({
        abilityId: MOVE,
        targetWorldSpacePos: map.getCombatRally(),
        unitTags: [unit.tag],
      });
    }
    return collectedActions;
  },
  scoutEnemyMainBehavior: async (resources, opponentRace) => {
    const { actions, map, units } = resources.get();
    const [ unit ] = units.withLabel('scoutEnemyMain');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, Alliance.ENEMY).filter(cannon => distance(cannon.pos, unit.pos) < 16);
      if (calculateTotalHealthRatio(unit) > 1/2 && !inRangeEnemyCannon) {
        const enemyMain = map.getEnemyMain();
        const randomPointsOfInterest = [...getRandomPoints(map, 3, enemyMain.areas.areaFill)];
        if (opponentRace === Race.ZERG) { randomPointsOfInterest.push(map.getEnemyNatural().townhallPosition); }
        if (randomPointsOfInterest.length > unit.orders.length) {
          randomPointsOfInterest.forEach(point => {
            const unitCommand = {
              abilityId: MOVE,
              unitTags: [ unit.tag ],
              queueCommand: true,
              targetWorldSpacePos: point,
            };
            collectedActions.push(unitCommand);
          });
        }
      } else {
        const unitCommand = {
          abilityId: MOVE,
          unitTags: [ unit.tag ],
          targetWorldSpacePos: getCombatRally(resources),
        };
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.length > 0 && await actions.sendAction(collectedActions);
  },
  scoutEnemyNaturalBehavior: async (resources) => {
    const { actions, map, units } = resources.get();
    const [ unit ] = units.withLabel('scoutEnemyNatural');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, Alliance.ENEMY).filter(cannon => distance(cannon.pos, unit.pos) < 16);
      if (calculateTotalHealthRatio(unit) > 1/2 && !inRangeEnemyCannon) {
        const enemyNatural = map.getEnemyNatural();
        const randomPointsOfInterest = [...getRandomPoints(map, 3, enemyNatural.areas.areaFill)];
        if (randomPointsOfInterest.length > unit.orders.length) {
          randomPointsOfInterest.forEach(point => {
            const unitCommand = {
              abilityId: MOVE,
              unitTags: [ unit.tag ],
              queueCommand: true,
              targetWorldSpacePos: point,
            };
            collectedActions.push(unitCommand);
          });
        }
      } else {
        const unitCommand = {
          abilityId: MOVE,
          unitTags: [ unit.tag ],
          targetWorldSpacePos: getCombatRally(resources),
        };
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.length > 0 && await actions.sendAction(collectedActions);
  },
}