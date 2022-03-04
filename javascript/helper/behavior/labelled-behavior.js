//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { PHOTONCANNON, LARVA } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../services/actions-service");
const { isFacing } = require("../../services/micro-service");
const { retreatToExpansion } = require("../../services/world-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine } = require("../../systems/manage-resources");
const scoutService = require("../../systems/scouting/scouting-service");
const { calculateTotalHealthRatio } = require("../../systems/unit-resource/unit-resource-service");
const { getClosestUnitByPath, distanceByPath } = require("../get-closest-by-path");
const { getCombatRally, getRandomPoints, getAcrossTheMap } = require("../location");
const { engageOrRetreat } = require("./army-behavior");

module.exports = {
  /**
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  acrossTheMapBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'scoutAcrossTheMap';
    const [unit] = units.withLabel(label);
    if (unit) {
      const enemyUnits = enemyTrackingService.mappedEnemyUnits.filter(enemyUnit => !(unit.unitType === LARVA) && distance(enemyUnit.pos, unit.pos) < 16);
      const combatUnits = units.getCombatUnits().filter(combatUnit => {
        if (combatUnit.tag === unit.tag) return true;
        else if (combatUnit.isAttacking()) {
          const foundOrder = combatUnit.orders.find(order => order.abilityId === ATTACK_ATTACK && units.getByTag(order.targetUnitTag));
          const targetPosition = foundOrder ? units.getByTag(foundOrder.targetUnitTag).pos : combatUnit.orders.find(order => order.abilityId === ATTACK_ATTACK).targetWorldSpacePos;
          if (targetPosition) {
            return distance(targetPosition, unit.pos) < 16;
          }
        }
      });
      // if an enemy unit within distance of 16, use engageOrRetreat logic, else ATTACK_ATTACK across the map
      if (enemyUnits.length > 0) {
        // get the closest enemy unit by path
        const [closestEnemyUnit] = getClosestUnitByPath(resources, unit.pos, enemyUnits);
        collectedActions.push(...engageOrRetreat(world, combatUnits, enemyUnits, closestEnemyUnit.pos));
      } else {
        const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
        unitCommand.targetWorldSpacePos = getAcrossTheMap(map);
        collectedActions.push(unitCommand);
      }
    }
    return collectedActions;
  },
  /**
   * 
   * @param {World} world 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  clearFromEnemyBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const label = 'clearFromEnemy';
    const [unit] = units.withLabel(label);
    const collectedActions = [];
    const combatRallyPosition = map.getCombatRally();
    if (unit) {
      let [closestEnemyUnit] = units.getClosest(unit.pos, enemyTrackingService.mappedEnemyUnits, 1);
      if (
        !closestEnemyUnit ||
        distance(unit.pos, closestEnemyUnit.pos) > 16 ||
        distance(unit.pos, combatRallyPosition) < 2
      ) {
        unit.labels.clear();
        console.log('clear!');
        collectedActions.push(gatherOrMine(resources, unit));
      } else {
        const [closestSelfUnit] = units.getClosest(combatRallyPosition, units.getAlive(Alliance.SELF).filter(unit => distance(unit.pos, combatRallyPosition) <= 16));
        if (closestSelfUnit && (closestSelfUnit['selfDPSHealth'] > closestEnemyUnit['selfDPSHealth'])) {
          collectedActions.push({
            abilityId: MOVE,
            targetWorldSpacePos: combatRallyPosition,
            unitTags: [unit.tag],
          });
        } else {
          const unitCommand = createUnitCommand(MOVE, [unit]);
          const enemyOutOfRangeButCloserToRally = (
            distanceByPath(resources, closestEnemyUnit.pos, combatRallyPosition) > 16 &&
            distanceByPath(resources, unit.pos, combatRallyPosition) >= distanceByPath(resources, closestEnemyUnit.pos, combatRallyPosition)
          );
          if (enemyOutOfRangeButCloserToRally) {
            unitCommand.targetWorldSpacePos = combatRallyPosition;
          } else {
            unitCommand.targetWorldSpacePos = retreatToExpansion(world, unit, closestEnemyUnit, false);
          }
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {UnitResource} units 
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  recruitToBattleBehavior: (units) => {
    const label = 'recruitToBattle';
    const collectedActions = [];
    units.withLabel(label).forEach(unit => {
      const targetPosition = unit.labels.get(label);
      if (distance(unit.pos, targetPosition) < 16) {
        unit.labels.delete(label);
      } else {
        const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
        unitCommand.targetWorldSpacePos = targetPosition;
        collectedActions.push(unitCommand);
      }
    });
    return collectedActions;
  },
  /**
   * @param {World} world 
   */
  scoutEnemyMainBehavior: async (world) => {
    const { data, resources } = world;
    const { actions, map, units } = resources.get();
    const [unit] = units.withLabel('scoutEnemyMain');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, { alliance: Alliance.ENEMY }).filter(cannon => distance(cannon.pos, unit.pos) < 16);
      if (calculateTotalHealthRatio(units, unit) > 1 / 2 && !inRangeEnemyCannon) {
        const threateningUnits = unit['enemyUnits'].filter((/** @type {Unit} */ enemyUnit) => {
          const threateningRangedUnit = isFacing(unit, enemyUnit) && data.getUnitTypeData(enemyUnit.unitType).weapons.some(w => w.range > 1) && !enemyUnit.isStructure() && distance(unit.pos, enemyUnit.pos) < 8
          const threateningMeleeUnit = enemyUnit.isMelee() && distance(unit.pos, enemyUnit.pos) < 4 && isFacing(unit, enemyUnit, 180 / 16, true);
          return (threateningRangedUnit || threateningMeleeUnit)
        });
        if (threateningUnits.length > 1) {
          unit.labels.set('Threatened');
          let [closestEnemyUnit] = units.getClosest(unit.pos, unit['enemyUnits'], 1);
          // retreat to farthest empty expansion that is closer to the unit than the enemy unit
          if (closestEnemyUnit) {
            const emptyExpansions = getEmptyExpansions(resources);
            const [farthestEmptyExpansionClosertToUnit] = emptyExpansions
              .filter(expansion => distanceByPath(resources, unit.pos, expansion.centroid) < distanceByPath(resources, closestEnemyUnit.pos, expansion.centroid));
            if (farthestEmptyExpansionClosertToUnit) {
              const unitCommand = createUnitCommand(MOVE, [unit]);
              unitCommand.targetWorldSpacePos = farthestEmptyExpansionClosertToUnit.centroid;
              collectedActions.push(unitCommand);
            } else {
              const unitCommand = createUnitCommand(MOVE, [unit]);
              unitCommand.targetWorldSpacePos = retreatToExpansion(world, unit, closestEnemyUnit, false);
              collectedActions.push(unitCommand);
            }
          }
        } else {
          unit.labels.delete('Threatened');
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
      if (calculateTotalHealthRatio(units, unit) > 1 / 2 && !inRangeEnemyCannon) {
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
/**
 * @param {ResourceManager} resources 
 * @returns {Expansion[]}
 */
function getEmptyExpansions(resources) {
  const { map, units } = resources.get();
  const emptyExpansions = map.getExpansions().filter(expansion => {
    const enemyUnits = units.getAlive({ alliance: Alliance.ENEMY }).filter(unit => distance(unit.pos, expansion.centroid) < 16);
    const selfUnits = units.getAlive({ alliance: Alliance.SELF }).filter(unit => distance(unit.pos, expansion.centroid) < 16);
    return enemyUnits.length === 0 && selfUnits.length === 0;
  });
  return emptyExpansions;
}
