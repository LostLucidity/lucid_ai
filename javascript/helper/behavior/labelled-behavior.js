//@ts-check
"use strict"

const { MOVE, ATTACK_ATTACK, BUILD_CREEPTUMOR_QUEEN, SMART } = require("@node-sc2/core/constants/ability");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");
const { mineralFieldTypes, vespeneGeyserTypes } = require("@node-sc2/core/constants/groups");
const { PHOTONCANNON, LARVA, CREEPTUMORBURROWED } = require("@node-sc2/core/constants/unit-type");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const { createUnitCommand } = require("../../services/actions-service");
const { getTravelDistancePerStep } = require("../../services/frames-service");
const { getPathablePositions, isCreepEdge, isInMineralLine, getMapPath } = require("../../services/map-resource-service");
const { isFacing } = require("../../services/micro-service");
const { getDistance, getClusters } = require("../../services/position-service");
const resourceManagerService = require("../../services/resource-manager-service");
const { getClosestUnitByPath, getDistanceByPath, getClosestPositionByPath, getCombatRally, getClosestPathablePositionsBetweenPositions, getCreepEdges } = require("../../services/resource-manager-service");
const { canAttack } = require("../../services/resources-service");
const { getWeaponThatCanAttack, getPendingOrders } = require("../../services/unit-service");
const { retreat, getUnitsInRangeOfPosition, calculateNearDPSHealth, getUnitTypeCount, getDPSHealth, engageOrRetreat } = require("../../services/world-service");
const enemyTrackingService = require("../../systems/enemy-tracking/enemy-tracking-service");
const { gatherOrMine } = require("../../systems/manage-resources");
const scoutService = require("../../systems/scouting/scouting-service");
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
    const collectedActions = [];
    const label = 'scoutAcrossTheMap';
    const [unit] = units.withLabel(label);

    if (unit) {
      const { pos } = unit; if (pos === undefined) return [];
      const enemyUnits = filterEnemyUnits(unit, enemyTrackingService.mappedEnemyUnits);
      const combatUnits = filterCombatUnits(units, unit, units.getCombatUnits());

      // if an enemy unit within distance of 16, use engageOrRetreat logic, else ATTACK_ATTACK across the map
      if (enemyUnits.length > 0) {
        // get the closest enemy unit by path
        const [closestEnemyUnit] = getClosestUnitByPath(resources, pos, enemyUnits);
        const { pos: enemyPos } = closestEnemyUnit; if (enemyPos === undefined) return [];
        collectedActions.push(...engageOrRetreat(world, combatUnits, enemyUnits, enemyPos));
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

    const occupiedTownhalls = map.getOccupiedExpansions().map(expansion => expansion.getBase());
    const { townhallPosition } = map.getEnemyNatural();

    idleCreeperQueens.forEach(unit => {
      let selectedCreepEdge;
      const { pos } = unit; if (pos === undefined) return collectedActions;
      if (getUnitTypeCount(world, CREEPTUMORBURROWED) <= 3) {
        const closestTownhallPositionToEnemy = occupiedTownhalls.reduce((/** @type {{ distance: number, pos: Point2D, pathCoordinates: Point2D[] }} */ closest, townhall) => {
          const { pos } = townhall; if (pos === undefined) return closest;
          const closestPathablePositionsBetweenPositions = getClosestPathablePositionsBetweenPositions(resources, pos, townhallPosition);
          const { distance, pathCoordinates } = closestPathablePositionsBetweenPositions;
          return distance < closest.distance ? { distance, pos, pathCoordinates } : closest;
        }, { distance: Infinity, pos: { x: 0, y: 0 }, pathCoordinates: [] });

        const creepEdgeAndPath = closestTownhallPositionToEnemy.pathCoordinates.filter(path => isCreepEdge(map, path));
        if (creepEdgeAndPath.length > 0) {
          selectedCreepEdge = getClosestPositionByPath(resources, closestTownhallPositionToEnemy.pos, creepEdgeAndPath, creepEdgeAndPath.length)[creepEdgeAndPath.length - 1];
        }
      } else {
        let clusteredCreepEdges = getClusters(getCreepEdges(resources, pos));
        const creepEdgeAndPathWithinRange = clusteredCreepEdges.filter(position => getDistanceSq(pos, position) <= 100); // using square distance
        if (creepEdgeAndPathWithinRange.length > 0) {
          clusteredCreepEdges = creepEdgeAndPathWithinRange;
        }
        selectedCreepEdge = getClosestPositionByPath(resources, pos, clusteredCreepEdges)[0];
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
    const collectedActions = [];
    const healthRatio = calculateTotalHealthRatio(units, scoutUnit);
    if (healthRatio > 0.5) {
      const closestThreateningUnit = getClosestByWeaponRange(world, scoutUnit, threateningUnits);
      if (closestThreateningUnit) {
        collectedActions.push(...handleThreateningUnits(world, scoutUnit, threateningUnits, closestThreateningUnit));
      }
    }

    collectedActions.push(...handleNonThreateningUnits(world, scoutUnit));

    return collectedActions;
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

/**
 * @param {Point2D} a
 * @param {Point2D} b
 * @returns {number}
 */
function getDistanceSq(a, b) {
  const { x: ax, y: ay } = a; if (ax === undefined || ay === undefined) return Infinity
  const { x: bx, y: by } = b; if (bx === undefined || by === undefined) return Infinity
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Gets a patrol point around the enemy's natural expansion.
 * @param {MapResource} map - The game map.
 * @returns {Point2D} A patrol point around the enemy's natural expansion.
 */
const getPatrolPointAroundNatural = (map) => {
  const { townhallPosition } = map.getEnemyNatural();
  const patrolRadius = 2.5; // Adjust this value as needed
  const angle = Math.random() * 2 * Math.PI; // Random angle
  const dx = patrolRadius * Math.cos(angle);
  const dy = patrolRadius * Math.sin(angle);
  const { x: tx, y: ty } = townhallPosition; if (tx === undefined || ty === undefined) return { x: 0, y: 0 };
  const patrolPoint = {
    x: tx + dx,
    y: ty + dy,
  };
  return patrolPoint;
};

// Add these new helper functions before the scoutEnemyMainBehavior function
const getFacingDirection = (unit) => {
  // Assuming the 'facing' property of the unit is in degrees and it represents the direction in which the unit is currently moving
  return unit.facing;
};

/**
 * Gets the direction from one position to another.
 * @param {MapResource} map - The game map.
 * @param {Unit} unit - The unit.
 * @param {Point2D} targetPos - The target position.
 * @returns {number | null} The direction from the unit to the target position.
 */
const getPathDirection = (map, unit, targetPos) => {
  if (!unit.pos) {
    return null;
  }

  const path = getMapPath(map, unit.pos, targetPos);
  if (path.length < 2) {
    // Cannot determine path direction if path length is less than 2
    return null;
  }

  const nextPos = path[1]; // Get the next position in the path
  const nextPosPoint = { x: nextPos[0], y: nextPos[1] }; // Convert to Point2D
  return getDirection(unit.pos, nextPosPoint); // Get the direction from current position to the next position
};

/**
 * Gets the direction from one position to another.
 * @param {MapResource} map - The game map.
 * @param {Unit} unit - The unit.
 * @param {Point2D} targetPos - The target position.
 * @returns {boolean} True if the unit is moving towards the target position, false otherwise.
 */
const isMovingTowards = (map, unit, targetPos) => {
  const pathDirection = getPathDirection(map, unit, targetPos);
  const facingDirection = getFacingDirection(unit);

  // Check if pathDirection is null
  if (pathDirection === null) {
    return false;
  }

  // Here, you can define the condition for a unit to be considered as 'moving towards' the target.
  // As a simple example, we can say that if the difference between the path direction and facing direction is small, the unit is moving towards the target.
  const directionDifference = Math.abs(pathDirection - facingDirection);

  return directionDifference < 30; // If the difference is less than 30 degrees, consider the unit as moving towards the target
};

/**
 * @param {Point2D} fromPos - The initial position.
 * @param {Point2D} toPos - The final position.
 * @returns {number | null} The angle in degrees from the initial position to the final position.
 */
const getDirection = (fromPos, toPos) => {
  if (!fromPos || !toPos || fromPos.x === undefined || fromPos.y === undefined || toPos.x === undefined || toPos.y === undefined) {
    return null;
  }
  const deltaX = toPos.x - fromPos.x;
  const deltaY = toPos.y - fromPos.y;
  const rad = Math.atan2(deltaY, deltaX); // In radians
  const deg = rad * (180 / Math.PI); // Convert to degrees
  return deg;
};

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
  if (closestThreateningUnit && threateningUnitsDPSHealth > selfUnitDPSHealth) {
    scoutUnit.labels.set('Threatened', true);
    const { pos, tag } = scoutUnit; if (pos === undefined || tag === undefined) return [];
    const { pos: enemyPos } = closestThreateningUnit;
    if (!pos || !enemyPos) return [];
    const farthestEmptyExpansionCloserToUnit = getEmptyExpansions(world.resources).find(expansion => {
      if (!expansion.centroid) {
        return false;
      }
      return getDistanceByPath(world.resources, pos, expansion.centroid) < getDistanceByPath(world.resources, enemyPos, expansion.centroid);
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
 * Checks if a unit has a pending building order.
 *
 * @param {Unit} unit - The unit to check.
 * @returns {boolean} - True if the unit has a pending building order, false otherwise.
 */
function hasBuildingOrder(unit) {
  // This example assumes that 'unit' has an 'orders' attribute that is an array of 'order' objects,
  // and each 'order' has an 'abilityId' that corresponds to the command the unit is currently performing.

  // This also assumes that you have a constant or function BUILD_COMMAND that corresponds to the id for the building command in your game.

  return unit.orders.some(order => order.abilityId === BUILD_COMMAND);
}
