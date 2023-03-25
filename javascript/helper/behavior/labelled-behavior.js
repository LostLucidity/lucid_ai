//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK, BUILD_CREEPTUMOR_QUEEN, SMART } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { mineralFieldTypes, vespeneGeyserTypes } = require("@node-sc2/core/constants/groups");
const { PHOTONCANNON, LARVA, CREEPTUMORBURROWED } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../services/actions-service");
const { getTravelDistancePerStep } = require("../../services/frames-service");
const { getPathablePositions, isCreepEdge, isInMineralLine } = require("../../services/map-resource-service");
const { isFacing } = require("../../services/micro-service");
const { getDistance } = require("../../services/position-service");
const resourceManagerService = require("../../services/resource-manager-service");
const { getClosestUnitByPath, getDistanceByPath, getClosestPositionByPath, getCombatRally, getClosestPathablePositionsBetweenPositions, getCreepEdges } = require("../../services/resource-manager-service");
const { canAttack } = require("../../services/resources-service");
const { getWeaponThatCanAttack, getPendingOrders } = require("../../services/unit-service");
const { retreat, getUnitsInRangeOfPosition, calculateNearDPSHealth, getUnitTypeCount, getDPSHealth } = require("../../services/world-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine } = require("../../systems/manage-resources");
const scoutService = require("../../systems/scouting/scouting-service");
const stateOfGameService = require("../../systems/state-of-game-system/state-of-game-service");
const { calculateTotalHealthRatio, isByItselfAndNotAttacking } = require("../../systems/unit-resource/unit-resource-service");
const { getRandomPoints, getAcrossTheMap } = require("../location");
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
      const { pos } = unit; if (pos === undefined) return collectedActions;
      const enemyUnits = enemyTrackingService.mappedEnemyUnits.filter(enemyUnit => {
        const { pos: enemyPos } = enemyUnit; if (enemyPos === undefined) return false;
        return !(unit.unitType === LARVA) && distance(enemyPos, pos) < 16 && canAttack(resources, unit, enemyUnit);
      });
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
    const collectedActions = [];
    const combatRallyPosition = getCombatRally(resources);
    const [unit] = units.withLabel(label);
    if (unit) {
      const { pos } = unit;
      if (pos === undefined) return [];
      let [closestEnemyUnit] = units.getClosest(unit.pos, getThreateningUnits(world, unit));
      if (
        !closestEnemyUnit ||
        distance(unit.pos, combatRallyPosition) < 2
      ) {
        unit.labels.clear();
        console.log('clear!');
        collectedActions.push(...gatherOrMine(resources, unit));
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
          const distanceEnemyToRally = getDistanceByPath(resources, closestEnemyUnit.pos, combatRallyPosition);
          const distanceToRally = getDistanceByPath(resources, pos, combatRallyPosition);
          const enemyOutOfRangeButCloserToRally = (
            distanceEnemyToRally > 16 &&
            distanceToRally >= distanceEnemyToRally
          );
          if (enemyOutOfRangeButCloserToRally) {
            unitCommand.targetWorldSpacePos = retreat(world, unit, closestEnemyUnit, false);
            const [closestPathablePosition] = getClosestPositionByPath(resources, pos, getPathablePositions(map, unitCommand.targetWorldSpacePos));
            console.log('retreat!', unitCommand.targetWorldSpacePos, getDistanceByPath(resources, pos, closestPathablePosition));
          } else {
            const selfCombatRallyUnits = getUnitsInRangeOfPosition(world, getCombatRally(resources));
            // @ts-ignore
            closestEnemyUnit['inRangeUnits'] = closestEnemyUnit['inRangeUnits'] || getUnitsInRangeOfPosition(world, closestEnemyUnit.pos);
            const selfCombatRallyDPSHealth = calculateNearDPSHealth(world, selfCombatRallyUnits, closestEnemyUnit['inRangeUnits'].map((/** @type {{ Unit: any }} */ unit) => unit.unitType));
            // @ts-ignore
            const inRangeCombatUnitsOfEnemyDPSHealth = calculateNearDPSHealth(world, closestEnemyUnit['inRangeUnits'], selfCombatRallyUnits.map(unit => unit.unitType));
            const shouldRallyToCombatRally = selfCombatRallyDPSHealth > inRangeCombatUnitsOfEnemyDPSHealth; 
            unitCommand.targetWorldSpacePos = retreat(world, unit, closestEnemyUnit, shouldRallyToCombatRally);
            const [closestPathablePosition] = getClosestPositionByPath(resources, pos, getPathablePositions(map, unitCommand.targetWorldSpacePos));
            console.log('rally!', shouldRallyToCombatRally, unitCommand.targetWorldSpacePos, getDistanceByPath(resources, pos, closestPathablePosition));
          }
          collectedActions.push(unitCommand);
        }
      }
    }
    return collectedActions;
  },
  /**
   * @param {World} world
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  creeperBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const collectedActions = [];
    const label = 'creeper';
    resourceManagerService.creepEdges = [];
    const idleCreeperQueens = units.withLabel(label).filter(unit => unit.isIdle());
    idleCreeperQueens.forEach(unit => {
      let selectedCreepEdge;
      const { pos } = unit; if (pos === undefined) return collectedActions;
      if (getUnitTypeCount(world, CREEPTUMORBURROWED) <= 3) {
        const occupiedTownhalls = map.getOccupiedExpansions().map(expansion => expansion.getBase());
        const { townhallPosition } = map.getEnemyNatural();
        const [closestTownhallPositionToEnemy] = getClosestUnitByPath(resources, townhallPosition, occupiedTownhalls).map(unit => unit.pos);
        if (closestTownhallPositionToEnemy === undefined) return collectedActions;
        const closestPathablePositionsBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, closestTownhallPositionToEnemy, townhallPosition);
        const { pathCoordinates } = closestPathablePositionsBetweenPositions;
        let creepEdgeAndPath = pathCoordinates.filter(path => isCreepEdge(map, path));
        if (creepEdgeAndPath.length > 0) {
          const creepEdgeAndPathWithinRange = creepEdgeAndPath.filter(position => getDistance(pos, position) <= 10 && getDistanceByPath(resources, pos, position) <= 10);
          if (creepEdgeAndPathWithinRange.length > 0) {
            creepEdgeAndPath = creepEdgeAndPathWithinRange;
          }
          const outEdgeCandidate = getClosestPositionByPath(resources, closestTownhallPositionToEnemy, creepEdgeAndPath, creepEdgeAndPath.length)[creepEdgeAndPath.length - 1];
          selectedCreepEdge = outEdgeCandidate;
        }
      } else {
        let creepCandidates = getCreepEdges(resources, pos);
        const creepEdgeAndPathWithinRange = getCreepEdges(resources, pos).filter(position => getDistance(pos, position) <= 10 && getDistanceByPath(resources, pos, position) <= 10);
        if (creepEdgeAndPathWithinRange.length > 0) {
          creepCandidates = creepEdgeAndPathWithinRange;
        }
        const [closestCreepEdge] = getClosestPositionByPath(resources, pos, creepCandidates);
        if (closestCreepEdge) {
          selectedCreepEdge = closestCreepEdge;
        }
      }
      if (selectedCreepEdge) {
        const abilityId = unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN) ? BUILD_CREEPTUMOR_QUEEN : MOVE;
        const unitCommand = {
          abilityId,
          targetWorldSpacePos: selectedCreepEdge,
          unitTags: [unit.tag]
        }
        collectedActions.push(unitCommand);
      }
    });
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
   * @returns {Promise<void>}
   */
  scoutEnemyMainBehavior: async (world) => {
    const { resources } = world;
    const { actions, map, units } = resources.get();
    const [unit] = units.withLabel('scoutEnemyMain');
    const collectedActions = [];
    if (unit) {
      const { pos } = unit; if (pos === undefined) return;
      const threateningUnits = getThreateningUnits(world, unit);
      if (calculateTotalHealthRatio(units, unit) > 0.5) {
        if (threateningUnits.length > 0) {
          const closestThreateningUnit = getClosestByWeaponRange(world, unit, threateningUnits); if (closestThreateningUnit === undefined) return;
          const selfUnits = units.getAlive().filter(unit => unit.pos && unit.alliance === Alliance.SELF && getDistance(pos, unit.pos) < 16);
          // @ts-ignore
          const threateningUnitsDPSHealth = getDPSHealth(world, closestThreateningUnit, selfUnits.map(unit => unit.unitType && unit.unitType));
          const enemyUnitTypes = threateningUnits.map(unit => unit.unitType && unit.unitType);
          // @ts-ignore
          const selfUnitDPSHealth = getDPSHealth(world, unit, enemyUnitTypes.filter(unitType => unitType !== undefined));
          if (threateningUnitsDPSHealth > selfUnitDPSHealth) {
            unit.labels.set('Threatened', true);
            let closestByWeaponRange = getClosestByWeaponRange(world, unit, threateningUnits);
            if (closestByWeaponRange) {
              const { pos: enemyPos } = closestByWeaponRange; if (enemyPos === undefined) return;
              const emptyExpansions = getEmptyExpansions(resources);
              const [farthestEmptyExpansionCloserToUnit] = emptyExpansions.filter(expansion => {
                const { centroid: expansionPos } = expansion; if (expansionPos === undefined) return;
                return getDistanceByPath(resources, pos, expansionPos) < getDistanceByPath(resources, enemyPos, expansionPos)
              });
              const unitCommand = createUnitCommand(MOVE, [unit]);
              if (farthestEmptyExpansionCloserToUnit) {
                unitCommand.targetWorldSpacePos = farthestEmptyExpansionCloserToUnit.centroid;
                collectedActions.push(unitCommand);
              } else {
                unitCommand.targetWorldSpacePos = retreat(world, unit, closestByWeaponRange, false);
                collectedActions.push(unitCommand);
              }
            }
          }  
        } else {
          let queueCommand = true;
          if (unit.labels.has('Threatened')) {
            unit.labels.delete('Threatened');
            queueCommand = false;
          }
          const { areas } = map.getEnemyMain();
          if (areas === undefined) return [];
          const pathableAreasFill = areas.areaFill.filter(pos => map.isPathable(pos));
          const randomPointsOfInterest = [...getRandomPoints(map, 3, pathableAreasFill)];
          if (scoutService.opponentRace === Race.ZERG) {
            const { townhallPosition } = map.getEnemyNatural();
            if (map.isPathable(townhallPosition)) {
              randomPointsOfInterest.push(townhallPosition);
            }
          }
          const { orders } = unit;
          if (orders === undefined) return [];
          const nonPlaceableOrderFound = orders.some(order => {
            if (order.abilityId === MOVE) {
              const { targetWorldSpacePos } = order;
              if (targetWorldSpacePos === undefined) return false;
              if (!map.isPathable(targetWorldSpacePos)) return true;
            }
            return false;
          });
          if (nonPlaceableOrderFound) {
            const unitCommand = createUnitCommand(MOVE, [unit]);
            unitCommand.targetWorldSpacePos = randomPointsOfInterest[0];
            unitCommand.queueCommand = false;
            collectedActions.push(unitCommand);
          } else {
            if (randomPointsOfInterest.length > orders.length) {
              queueCommand = isGathering(units, unit) ? false : true;
              randomPointsOfInterest.forEach(point => {
                const unitCommand = {
                  abilityId: MOVE,
                  unitTags: [unit.tag],
                  queueCommand: queueCommand,
                  targetWorldSpacePos: point,
                };
                collectedActions.push(unitCommand);
                queueCommand = true;
              });
            }
          }
        }
      } else {
        if (threateningUnits.length > 0) {
          let [closestThreateningUnit] = units.getClosest(pos, threateningUnits, 1);
          const unitCommand = createUnitCommand(MOVE, [unit]);
          if (closestThreateningUnit) {
            unitCommand.targetWorldSpacePos = retreat(world, unit, closestThreateningUnit, false);
            const { targetWorldSpacePos } = unitCommand;
            if (targetWorldSpacePos === undefined) return;
            console.log('retreat!', pos, targetWorldSpacePos, getDistanceByPath(resources, pos, targetWorldSpacePos));
          } else {
            unitCommand.targetWorldSpacePos = getCombatRally(resources);
            const { targetWorldSpacePos } = unitCommand;
            console.log('rally!', pos, targetWorldSpacePos, getDistanceByPath(resources, pos, targetWorldSpacePos));
          }
          collectedActions.push(unitCommand);
        }
      }
    }
    collectedActions.length > 0 && await actions.sendAction(collectedActions);
  },
  scoutEnemyNaturalBehavior: async (/** @type {ResourceManager} */ resources) => {
    const { actions, map, units } = resources.get();
    const [unit] = units.withLabel('scoutEnemyNatural');
    const collectedActions = [];
    if (unit) {
      const [inRangeEnemyCannon] = units.getById(PHOTONCANNON, Alliance.ENEMY).filter((/** @type {{ pos: Point2D; }} */ cannon) => distance(cannon.pos, unit.pos) < 16);
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
/**
 * @param {World} world
 * @param {Unit} unit
 * @returns {Unit[]}
 */
function getThreateningUnits(world, unit) {
  const { data, resources } = world;
  const { map, units } = resources.get();
  const { pos, radius} = unit; if (pos === undefined || radius === undefined) return [];
  const enemyUnits = unit['enemyUnits'] || stateOfGameService.getEnemyUnits(unit);
  const threateningUnits = enemyUnits && enemyUnits.filter((/** @type {Unit} */ enemyUnit) => {
    const { pos: enemyPos, radius: enemyRadius, unitType } = enemyUnit; if (enemyPos === undefined || enemyRadius === undefined || unitType === undefined) return false;
    if (enemyUnit.isWorker() && (isInMineralLine(map, enemyPos) || isByItselfAndNotAttacking(units, enemyUnit))) return false;
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, unit);
    if (weaponThatCanAttack) {
      const distanceToEnemy = getDistance(pos, enemyPos);
      const { range } = weaponThatCanAttack; if (range === undefined) return false;
      const getSightRange = enemyUnit.data().sightRange || 0;
      const weaponRangeOfEnemy = range + radius + enemyRadius + getTravelDistancePerStep(enemyUnit) + getTravelDistancePerStep(unit);
      const inWeaponRange = distanceToEnemy <= weaponRangeOfEnemy;
      const degrees = inWeaponRange ? 180 / 4 : 180 / 8;
      const higherRange = weaponRangeOfEnemy > getSightRange ? weaponRangeOfEnemy : getSightRange;
      const enemyFacingUnit = enemyUnit.isMelee() ? isFacing(enemyUnit, unit, degrees) : true;
      return distanceToEnemy <= higherRange && enemyFacingUnit;
    }
  });
  return threateningUnits || [];
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} threateningUnits\
 * @returns Unit
 */
function getClosestByWeaponRange(world, unit, threateningUnits) {
  const { data } = world;
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return;
  const closestThreateningUnit = threateningUnits.reduce((/** @type {{distance: number; unit: Unit;} | undefined} */ closest, threateningUnit) => {
    const { pos: threateningUnitPos, radius: threateningUnitRadius, unitType } = threateningUnit; if (threateningUnitPos === undefined || threateningUnitRadius === undefined || unitType === undefined) return closest;
   const distanceToThreateningUnit = getDistance(pos, threateningUnitPos);
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, unit);
    if (weaponThatCanAttack) {
      const { range } = weaponThatCanAttack; if (range === undefined) return closest;
      const weaponRangeOfThreateningUnit = range + radius + threateningUnitRadius + getTravelDistancePerStep(threateningUnit) + getTravelDistancePerStep(unit);
      if (distanceToThreateningUnit <= weaponRangeOfThreateningUnit) {
        return closest && closest.distance < distanceToThreateningUnit ? closest : { distance: distanceToThreateningUnit, unit: threateningUnit };
      }
    }
    return closest;
  }, undefined);
  return closestThreateningUnit && closestThreateningUnit.unit; 
}
/**
 * @param {UnitResource} units
 * @param {Unit} unit
 * @param {"minerals" | "vespene" | undefined} type
 * @returns {boolean}
 */
function isGathering(units, unit, type=undefined) {
  const pendingOrders = getPendingOrders(unit);
  if (pendingOrders.length > 0) {
    return pendingOrders.some(order => {
      const { abilityId } = order; if (abilityId === undefined) return false;
      const smartOrder = abilityId === SMART;
      if (smartOrder) {
        const { targetUnitTag } = order; if (targetUnitTag === undefined) return false;
        const targetUnit = units.getByTag(targetUnitTag);
        if (targetUnit) {
          const { unitType } = targetUnit; if (unitType === undefined) return false;
          return mineralFieldTypes.includes(unitType) || vespeneGeyserTypes.includes(unitType);
        }
      }
    });
  } else {
    return unit.isGathering(type);
  } 
}

