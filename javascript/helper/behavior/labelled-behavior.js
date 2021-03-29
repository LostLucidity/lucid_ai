//@ts-check
"use strict"

const { MOVE } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { PHOTONCANNON } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { calculateTotalHealthRatio } = require("../calculate-health");
const { getCombatRally, getRandomPoints } = require("../location");

module.exports = {
  clearFromEnemyBehavior: (resources) => {
    const { map, units } = resources.get();
    const label = 'clearFromEnemy';
    const [ unit ] = units.withLabel(label);
    const collectedActions = [];
    if (unit) {
      let [ closestEnemyUnit ] = units.getClosest(unit.pos, units.getAlive(Alliance.ENEMY), 1);
      if (!closestEnemyUnit || distance(closestEnemyUnit.pos, unit.pos) > 16) {
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
  scoutEnemyMainBehavior: (resources, opponentRace) => {
    const { map, units } = resources.get();
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
    return collectedActions;
  },
}