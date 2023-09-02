//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK, BUILD_CREEPTUMOR_QUEEN, SMART } = require("@node-sc2/core/constants/ability");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { mineralFieldTypes, vespeneGeyserTypes } = require("@node-sc2/core/constants/groups");
const { PHOTONCANNON, LARVA, CREEPTUMORBURROWED } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../services/actions-service");
const { getTravelDistancePerStep } = require("../../services/frames-service");
const { getPathablePositions, isCreepEdge, isInMineralLine, getMapPath } = require("../../systems/map-resource-system/map-resource-service");
const { isFacing } = require("../../services/micro-service");
const { getDistance, getClusters, getDistanceSquared } = require("../../services/position-service");
const resourceManagerService = require("../../services/resource-manager-service");
const { getClosestUnitByPath, getDistanceByPath, getClosestPositionByPath, getCombatRally, getClosestPathablePositionsBetweenPositions, getCreepEdges } = require("../../services/resource-manager-service");
const { canAttack } = require("../../services/resources-service");
const { getWeaponThatCanAttack, getPendingOrders } = require("../../services/unit-service");
const { retreat, getUnitsInRangeOfPosition, calculateNearDPSHealth, getUnitTypeCount, getDPSHealth, engageOrRetreat } = require("../../src/world-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine } = require("../../systems/manage-resources");
const stateOfGameService = require("../../systems/state-of-game-system/state-of-game-service");
const { calculateTotalHealthRatio, isByItselfAndNotAttacking, isMining } = require("../../systems/unit-resource/unit-resource-service");
const { getRandomPoints, getAcrossTheMap } = require("../location");

module.exports = {
  /**
 * @param {World} world 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
  acrossTheMapBehavior: (world) => {
    const { resources } = world;
    const { map, units } = resources.get();
    const label = 'scoutAcrossTheMap';
    const [unit] = units.withLabel(label);

    // If no unit with the given label, return early
    if (!unit) return [];

    const { pos } = unit;
    if (!pos) return [];

    const enemyUnits = filterEnemyUnits(unit, enemyTrackingService.mappedEnemyUnits);
    const combatUnits = filterCombatUnits(units, unit, units.getCombatUnits());

    const collectedActions = [];

    // If an enemy unit within distance of 16, use engageOrRetreat logic
    if (enemyUnits.length > 0) {
      const [closestEnemyUnit] = getClosestUnitByPath(resources, pos, enemyUnits);

      const { pos: enemyPos } = closestEnemyUnit;
      if (!enemyPos) return [];

      collectedActions.push(...engageOrRetreat(world, combatUnits, enemyUnits, enemyPos, false));
    } else {
      // If no enemy units close, move ATTACK_ATTACK across the map
      const unitCommand = createUnitCommand(ATTACK_ATTACK, [unit]);
      unitCommand.targetWorldSpacePos = getAcrossTheMap(map);
      collectedActions.push(unitCommand);
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
    const { units } = resources.get();
    const collectedActions = [];

    const creeperQueens = units.withLabel('creeper');

    creeperQueens.forEach(unit => {
      const pos = unit.pos;
      if (!pos) return;

      if (handleThreats(world, unit, collectedActions)) return;
      if (!unit.isIdle()) return;

      handleCreepSpread(world, unit, collectedActions);
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
   * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
   */
  scoutEnemyMainBehavior: (world) => {
    const { resources } = world;
    const { units } = resources.get();
    const scoutUnit = units.withLabel('scoutEnemyMain')[0];
    if (!scoutUnit) return [];
    const { pos } = scoutUnit;
    if (!pos) return [];

    const threateningUnits = getThreateningUnits(world, scoutUnit);

    // Check for threats first
    if (threateningUnits.length > 0) {
      const healthRatio = calculateTotalHealthRatio(units, scoutUnit);
      if (healthRatio > 0.5) {
        const closestThreateningUnit = getClosestByWeaponRange(world, scoutUnit, threateningUnits);
        if (closestThreateningUnit) {
          return handleThreateningUnits(world, scoutUnit, threateningUnits, closestThreateningUnit);
        }
      }
    }

    // If no threats, handle non-threatening units
    return handleNonThreateningUnits(world, scoutUnit);
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
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return [];
  const enemyUnits = unit['enemyUnits'] || stateOfGameService.getEnemyUnits(unit);
  const threateningUnits = enemyUnits && enemyUnits.filter((/** @type {Unit} */ enemyUnit) => {
    const { pos: enemyPos, radius: enemyRadius, unitType } = enemyUnit;
    if (enemyPos === undefined || enemyRadius === undefined || unitType === undefined) return false;
    if (enemyUnit.isWorker() && (isInMineralLine(map, enemyPos) || isByItselfAndNotAttacking(units, enemyUnit))) return false;
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, unit);
    if (weaponThatCanAttack) {
      const distanceToEnemy = getDistance(pos, enemyPos);
      const { range } = weaponThatCanAttack; if (range === undefined) return false;
      const getSightRange = enemyUnit.data().sightRange || 0;
      const weaponRangeOfEnemy = range + radius + enemyRadius + getTravelDistancePerStep(map, enemyUnit) + getTravelDistancePerStep(map, unit);
      const inWeaponRange = distanceToEnemy <= weaponRangeOfEnemy;
      const degrees = inWeaponRange ? 180 / 4 : 180 / 8;
      const higherRange = weaponRangeOfEnemy > getSightRange ? weaponRangeOfEnemy : getSightRange;
      const enemyFacingUnit = enemyUnit.isMelee() ? isFacing(enemyUnit, unit, degrees) : true;

      console.log(`Unit: ${unit.unitType}, Enemy: ${enemyUnit.unitType}, Weapon: ${weaponThatCanAttack ? weaponThatCanAttack.name : 'none'}, Range: ${range}, Distance to enemy: ${distanceToEnemy}, Weapon range of enemy: ${weaponRangeOfEnemy}, In weapon range: ${inWeaponRange}, Higher range: ${higherRange}, Enemy facing unit: ${enemyFacingUnit}`);

      return distanceToEnemy <= higherRange && enemyFacingUnit;
    }
  });
  return threateningUnits || [];
}
/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit[]} threateningUnits
 * @returns Unit
 */
function getClosestByWeaponRange(world, unit, threateningUnits) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { pos, radius } = unit; if (pos === undefined || radius === undefined) return;
  const closestThreateningUnit = threateningUnits.reduce((/** @type {{distance: number; unit: Unit;} | undefined} */ closest, threateningUnit) => {
    const { pos: threateningUnitPos, radius: threateningUnitRadius, unitType } = threateningUnit; if (threateningUnitPos === undefined || threateningUnitRadius === undefined || unitType === undefined) return closest;
   const distanceToThreateningUnit = getDistance(pos, threateningUnitPos);
    const weaponThatCanAttack = getWeaponThatCanAttack(data, unitType, unit);
    if (weaponThatCanAttack) {
      const { range } = weaponThatCanAttack; if (range === undefined) return closest;
      const weaponRangeOfThreateningUnit = range + radius + threateningUnitRadius + getTravelDistancePerStep(map, threateningUnit) + getTravelDistancePerStep(map, unit);
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

/**
 * @param {Unit} unit
 * @param {Unit[]} enemyUnits
 * @returns {Unit[]}
 */
function filterEnemyUnits(unit, enemyUnits) {
  const { pos } = unit; if (pos === undefined) return [];
  return enemyUnits.filter(enemyUnit => {
    const { pos: enemyPos } = enemyUnit;
    if (enemyPos === undefined) return false;
    return !(unit.unitType === LARVA) && distance(enemyPos, pos) < 16 && canAttack(unit, enemyUnit, false);
  });
}

/**
 * @param {UnitResource} units
 * @param {Unit} unit
 * @param {Unit[]} combatUnits
 * @returns {Unit[]}
 */
function filterCombatUnits(units, unit, combatUnits) {
  const { pos } = unit; if (pos === undefined) return [];
  return combatUnits.filter(combatUnit => {
    if (combatUnit.tag === unit.tag) return true;
    else if (combatUnit.isAttacking()) {
      const { orders } = combatUnit; if (orders === undefined) return false;
      const foundOrder = orders.find(order =>
        order.abilityId === ATTACK_ATTACK &&
        order.targetUnitTag !== undefined &&
        units.getByTag(order.targetUnitTag)
      );
      let targetPosition;
      if (foundOrder && foundOrder.targetUnitTag) {
        const targetUnit = units.getByTag(foundOrder.targetUnitTag);
        targetPosition = targetUnit ? targetUnit.pos : undefined;
      } else {
        targetPosition = combatUnit.orders ? combatUnit.orders.find(order => order.abilityId === ATTACK_ATTACK)?.targetWorldSpacePos : undefined;
      }
      return targetPosition && distance(targetPosition, pos) < 16;
    }
  });
}

/**
 * Get units close to a target unit.
 *
 * @param {UnitResource} units - The set of all units to filter.
 * @param {Unit} targetUnit - The unit to measure distance from.
 * @param {number} range - The maximum distance from the target unit a unit can be.
 * @returns {Unit[]} - The units within range of the target unit.
 */
function getUnitsCloseTo(units, targetUnit, range) {
  const { pos: targetPos } = targetUnit;
  if (targetPos === undefined) return [];

  return units.getAlive().filter(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    const distance = getDistance(targetPos, pos);
    return distance < range && unit.alliance === Alliance.SELF;
  });
}

/**
 * Handle the case where there are threatening units near the scout.
 *
 * @param {World} world The current world state.
 * @param {Unit} scoutUnit The scouting unit.
 * @param {Unit[]} threateningUnits The threatening units.
 * @param {Unit} closestThreateningUnit The closest threatening unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to perform.
 */
function handleThreateningUnits(world, scoutUnit, threateningUnits, closestThreateningUnit) {
  const { units } = world.resources.get();
  const collectedActions = [];
  const selfUnits = getUnitsCloseTo(units, scoutUnit, 16);
  const threateningUnitsDPSHealth = getDPSHealth(world, closestThreateningUnit, selfUnits.reduce((/** @type {UnitTypeId[]} */ unitTypes, unit) => {
    const { unitType } = unit; if (unitType === undefined) return unitTypes;
    if (!unitTypes.includes(unitType)) {
      unitTypes.push(unitType);
    }
    return unitTypes;
  }, []));
  const enemyUnitTypes = threateningUnits.reduce((/** @type {UnitTypeId[]} */ unitTypes, unit) => {
    const { unitType } = unit; if (unitType === undefined) return unitTypes;
    if (!unitTypes.includes(unitType)) {
      unitTypes.push(unitType);
    }
    return unitTypes;
  }, []);
  const selfUnitDPSHealth = getDPSHealth(world, scoutUnit, enemyUnitTypes);

  const BUFFER_DISTANCE = 2; // Set the buffer distance

  if (closestThreateningUnit && threateningUnitsDPSHealth > selfUnitDPSHealth) {
    scoutUnit.labels.set('Threatened', true);
    const { pos, tag } = scoutUnit; if (pos === undefined || tag === undefined) return [];
    const { pos: enemyPos } = closestThreateningUnit;
    if (!pos || !enemyPos) return [];
    const farthestEmptyExpansionCloserToUnit = getEmptyExpansions(world.resources).find(expansion => {
      if (!expansion.centroid) {
        return false;
      }
      const scoutDistance = getDistanceByPath(world.resources, pos, expansion.centroid);
      const enemyDistance = getDistanceByPath(world.resources, enemyPos, expansion.centroid);

      // Check if the scout's distance to the expansion (plus the buffer) is less than the enemy's distance
      return scoutDistance + BUFFER_DISTANCE < enemyDistance;
    });

    collectedActions.push({
      abilityId: MOVE,
      unitTags: [tag],
      targetWorldSpacePos: farthestEmptyExpansionCloserToUnit ? farthestEmptyExpansionCloserToUnit.centroid : retreat(world, scoutUnit, closestThreateningUnit, false),
    });
  }

  return collectedActions;
}

/**
 * Handle the case where there are no threatening units near the scout.
 *
 * @param {World} world The current world state.
 * @param {Unit} scoutUnit The scouting unit.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to perform.
 */
function handleNonThreateningUnits(world, scoutUnit) {
  const { map, units } = world.resources.get();
  const { orders, tag } = scoutUnit; if (orders === undefined || tag === undefined) return [];
  const collectedActions = [];
  const nonPlaceableOrderFound = scoutUnit.orders?.some(order => order.abilityId === MOVE && order.targetWorldSpacePos !== undefined && !map.isPathable(order.targetWorldSpacePos));
  const { areas } = map.getEnemyMain();
  if (areas === undefined) return [];
  const pathableAreasFill = areas.areaFill.filter(pos => map.isPathable(pos));
  const randomPointsOfInterest = [...getRandomPoints(map, 3, pathableAreasFill)];
  if (nonPlaceableOrderFound) {
    collectedActions.push({
      abilityId: MOVE,
      unitTags: [tag],
      targetWorldSpacePos: randomPointsOfInterest[0],
      queueCommand: false,
    });
  } else {
    if (randomPointsOfInterest.length > orders.length) {
      let queueCommand = isGathering(units, scoutUnit) && !isMining(units, scoutUnit) ? false : true;
      randomPointsOfInterest.forEach(point => {
        collectedActions.push({
          abilityId: MOVE,
          unitTags: [scoutUnit.tag],
          targetWorldSpacePos: point,
          queueCommand,
        });
        queueCommand = true;
      });
    }
  }
  return collectedActions;
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 * @returns {boolean}
 */
function handleThreats(world, unit, collectedActions) {
  const { resources } = world;
  const { units } = resources.get();
  const { pos } = unit; if (pos === undefined) return false;
  const nearbyEnemyUnits = units.getClosest(pos, units.getAlive(Alliance.ENEMY)
    .filter((/** @type {Unit} */ e) => e.pos && getDistanceSquared(pos, e.pos) <= 16 * 16));
  if (nearbyEnemyUnits.length > 0) {
    collectedActions.push(...engageOrRetreat(world, [unit], nearbyEnemyUnits, getCombatRally(resources)));
    return true; // Threat handled, skip rest of behavior for this unit
  }
  return false; // No threats
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 * @returns {void}
 */
function handleCreepSpread(world, unit, collectedActions) {
  const { resources } = world;
  const { pos } = unit; if (pos === undefined) return;
  /** @type Point2D | undefined */
  let selectedCreepEdge;


  if (getUnitTypeCount(world, CREEPTUMORBURROWED) <= 3) {
    selectedCreepEdge = getCreepEdgeCloseToEnemy(resources);
  } else {
    selectedCreepEdge = getCreepEdgeCloseToEnemy(resources, pos);
  }

  if (selectedCreepEdge) {
    issueCreepCommand(unit, selectedCreepEdge, collectedActions);
  }
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D | undefined} pos
 * @returns {Point2D | undefined}
 */
function getCreepEdgeCloseToEnemy(resources, pos=undefined) {
  const { map } = resources.get();
  if (!pos) {
    const occupiedTownhalls = map.getOccupiedExpansions().map(expansion => expansion.getBase());
    const { townhallPosition } = map.getEnemyNatural();
    const closestTownhallPositionToEnemy = occupiedTownhalls.reduce((/** @type {{ distance: number, pos: Point2D, pathCoordinates: Point2D[] }} */ closest, townhall) => {
      const pos = townhall.pos;
      if (!pos) return closest;
  
      const pathData = getClosestPathablePositionsBetweenPositions(resources, pos, townhallPosition);
      const { distance, pathCoordinates } = pathData;
      return distance < closest.distance ? { distance, pos, pathCoordinates } : closest;
    }, { distance: Infinity, pos: { x: 0, y: 0 }, pathCoordinates: [] });
  
    const creepEdgeAndPath = closestTownhallPositionToEnemy.pathCoordinates.filter(path => isCreepEdge(map, path));
    if (creepEdgeAndPath.length > 0) {
      return getClosestPositionByPath(resources, closestTownhallPositionToEnemy.pos, creepEdgeAndPath, creepEdgeAndPath.length)[creepEdgeAndPath.length - 1];
    }
  } else {
    let clusteredCreepEdges = getClusters(getCreepEdges(resources, pos));
    const creepEdgeAndPathWithinRange = clusteredCreepEdges.filter(position => getDistanceSquared(pos, position) <= 100); // using square distance
    if (creepEdgeAndPathWithinRange.length > 0) {
      clusteredCreepEdges = creepEdgeAndPathWithinRange;
    }
    return getClosestPositionByPath(resources, pos, clusteredCreepEdges)[0];
  }
}

/**
 * @param {Unit} unit
 * @param {Point2D} selectedCreepEdge
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions
 * @returns {void}
 */
function issueCreepCommand(unit, selectedCreepEdge, collectedActions) {
  const { pos, tag } = unit;
  if (pos === undefined || tag === undefined) return;

  const distanceToCreepEdge = getDistance(pos, selectedCreepEdge);
  const isCloseEnough = distanceToCreepEdge <= 0.8;
  const canBuildTumor = unit.abilityAvailable(BUILD_CREEPTUMOR_QUEEN);

  if (!isCloseEnough) {
    // If the unit isn't close enough to the creep edge, command it to MOVE
    collectedActions.push({
      abilityId: MOVE,
      targetWorldSpacePos: selectedCreepEdge,
      unitTags: [tag]
    });
  } else if (isCloseEnough && canBuildTumor) {
    // If the unit is close enough and can build the tumor, issue the BUILD_CREEPTUMOR_QUEEN command
    collectedActions.push({
      abilityId: BUILD_CREEPTUMOR_QUEEN,
      targetWorldSpacePos: selectedCreepEdge,  // Assuming the tumor is built on the creep edge
      unitTags: [tag]
    });
  }
}


