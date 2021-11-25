//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { PHOTONCANNON, LARVA } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { isFacing } = require("../../services/micro-service");
const { retreatToExpansion } = require("../../services/resource-manager-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const scoutService = require("../../systems/scouting/scouting-service");
const { calculateTotalHealthRatio } = require("../calculate-health");
const { getClosestUnitByPath } = require("../get-closest-by-path");
const { getCombatRally, getRandomPoints, acrossTheMap } = require("../location");
const { engageOrRetreat } = require("./army-behavior");

module.exports = {
  /**
   * 
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  acrossTheMapBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'acrossTheMap';
    const [unit] = units.withLabel(label);
    if (unit) {
      const enemyUnits = enemyTrackingService.mappedEnemyUnits.filter(enemyUnit => !(unit.unitType === LARVA) && distance(enemyUnit.pos, unit.pos) < 16);
      const combatUnits = units.getCombatUnits().filter(combatUnit => {
        if (combatUnit.tag === unit.tag) return true;
        else if (combatUnit.isAttacking()) {
          const foundOrder = combatUnit.orders.find(order => order.abilityId === ATTACK_ATTACK && units.getByTag(order.targetUnitTag));
          const targetPosition = foundOrder ? units.getByTag(foundOrder.targetUnitTag).pos : combatUnit.orders.find(order => order.abilityId === ATTACK_ATTACK).targetWorldSpacePos;
          return distance(targetPosition, unit.pos) < 16;
        }
      });
      let [closestEnemyUnit] = getClosestUnitByPath(resources, unit.pos, enemyUnits);
      if (closestEnemyUnit && unit['selfDPSHealth'] < closestEnemyUnit['selfDPSHealth']) {
        collectedActions.push(...engageOrRetreat(world, combatUnits, enemyUnits, closestEnemyUnit.pos, false));
      } else {
        collectedActions.push({
          abilityId: ATTACK_ATTACK,
          unitTags: [unit.tag],
          targetWorldSpacePos: acrossTheMap(map),
        });
      }
    }
    return collectedActions;
  },
  /**
   * 
   * @param {ResourceManager} resources 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  clearFromEnemyBehavior: (resources) => {
    const { map, units } = resources.get();
    const label = 'clearFromEnemy';
    const [unit] = units.withLabel(label);
    const collectedActions = [];
    if (unit) {
      let [closestEnemyUnit] = units.getClosest(unit.pos, enemyTrackingService.mappedEnemyUnits, 1);
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
  scoutEnemyMainBehavior: async (world) => {
    const { data, resources } = world;
    const { actions, map, units } = resources.get();
    const [unit] = units.withLabel('scoutEnemyMain');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, Alliance.ENEMY).filter(cannon => distance(cannon.pos, unit.pos) < 16);
      if (calculateTotalHealthRatio(unit) > 1 / 2 && !inRangeEnemyCannon) {
        if (unit.enemyUnits.filter(enemyUnit => isFacing(unit, enemyUnit) && data.getUnitTypeData(enemyUnit.unitType).weapons.some(w => w.range > 1) && !enemyUnit.isStructure() && distance(unit.pos, enemyUnit.pos) < 8).length > 1) {
          let [closestEnemyUnit] = units.getClosest(unit.pos, unit.enemyUnits, 1);
          collectedActions.push({
            abilityId: MOVE,
            unitTags: [unit.tag],
            targetWorldSpacePos: retreatToExpansion(resources, unit, closestEnemyUnit),
          });
        } else {
          const enemyMain = map.getEnemyMain();
          const randomPointsOfInterest = [...getRandomPoints(map, 3, enemyMain.areas.areaFill)];
          if (scoutService.opponentRace === Race.ZERG) { randomPointsOfInterest.push(map.getEnemyNatural().townhallPosition); }
          if (randomPointsOfInterest.length > unit.orders.length) {
            randomPointsOfInterest.forEach(point => {
              const unitCommand = {
                abilityId: MOVE,
                unitTags: [unit.tag],
                queueCommand: true,
                targetWorldSpacePos: point,
              };
              collectedActions.push(unitCommand);
            });
          }
        }
      } else {
        const unitCommand = {
          abilityId: MOVE,
          unitTags: [unit.tag],
          targetWorldSpacePos: getCombatRally(resources),
        };
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.length > 0 && await actions.sendAction(collectedActions);
  },
  scoutEnemyNaturalBehavior: async (resources) => {
    const { actions, map, units } = resources.get();
    const [unit] = units.withLabel('scoutEnemyNatural');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, Alliance.ENEMY).filter(cannon => distance(cannon.pos, unit.pos) < 16);
      if (calculateTotalHealthRatio(unit) > 1 / 2 && !inRangeEnemyCannon) {
        const enemyNatural = map.getEnemyNatural();
        const randomPointsOfInterest = [...getRandomPoints(map, 3, enemyNatural.areas.areaFill)];
        if (randomPointsOfInterest.length > unit.orders.length) {
          randomPointsOfInterest.forEach(point => {
            const unitCommand = {
              abilityId: MOVE,
              unitTags: [unit.tag],
              queueCommand: true,
              targetWorldSpacePos: point,
            };
            collectedActions.push(unitCommand);
          });
        }
      } else {
        const unitCommand = {
          abilityId: MOVE,
          unitTags: [unit.tag],
          targetWorldSpacePos: getCombatRally(resources),
        };
        collectedActions.push(unitCommand);
      }
    }
    collectedActions.length > 0 && await actions.sendAction(collectedActions);
  },
}
