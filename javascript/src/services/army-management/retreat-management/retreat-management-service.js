//@ts-check
"use strict";

// Import necessary dependencies
const { MOVE } = require('@node-sc2/core/constants/ability');
const { getTimeInSeconds, getTravelDistancePerStep } = require('../../../../services/frames-service');
const { pathFindingService } = require('../../pathfinding');
const MapResourceService = require('../../../../systems/map-resource-system/map-resource-service');
const { moveAwayPosition, getDistance, getDistanceSquared } = require('../../../../services/position-service');
const { Alliance, WeaponTargetType } = require('@node-sc2/core/constants/enums');
const { getClosestPosition } = require('../../../../helper/get-closest');
const unitResourceService = require('../../../../systems/unit-resource/unit-resource-service');
const { getDistanceBetween } = require('../../utility-service');
const unitService = require('../../../../services/unit-service');
const { existsInMap } = require('../../../../helper/location');
const { UnitType } = require('@node-sc2/core/constants');
const enemyTrackingService = require('../../enemy-tracking/enemy-tracking-service');
const { canAttack } = require('../../../../services/resources-service');
const { getPathCoordinates } = require('../../../../services/path-service');
const enemyTrackingServiceV2 = require('../../../../systems/enemy-tracking/enemy-tracking-service');
const positionService = require('../../../../services/position-service');
const { subtractVectors, getProjectedPosition, dotVectors } = require('../../../shared-utilities/vector-utils');
const { pointsOverlap } = require('../../../../helper/utilities');
const trackUnitsService = require('../../../../systems/track-units/track-units-service');
const { calculateTimeToKillUnits } = require('../../combat-statistics');
const { getCombatRally } = require('../../shared-config/combatRallyConfig');
const { isStrongerAtPosition } = require('../../combat-shared/combat-evaluation-service');

class RetreatManagementService {
  /**
   * Creates an instance of RetreatManagementService.
   * @param {import('../../../interfaces/i-logging-service').ILoggingService} loggingService - The logging service to be used for logging actions.
   */  
  constructor(loggingService) {
    this.loggingService = loggingService;
  }

  /**
   * Creates a retreat command for a given unit.
   *
   * @param {World} world - The game world.
   * @param {Unit} unit - The unit that needs to retreat.
   * @param {Unit[]} enemyUnits - The enemy units that the unit is retreating from.
   * @returns {SC2APIProtocol.ActionRawUnitCommand | undefined} - The retreat command, if the unit tag is defined.
   */
  createRetreatCommand(world, unit, enemyUnits) {
    if (unit.tag) { // Ensure the unit tag is not undefined
      const retreatPosition = this.retreat(world, unit, enemyUnits);

      // If a valid retreat position is found, create and return the retreat command
      if (retreatPosition) {
        return {
          abilityId: MOVE,
          unitTags: [unit.tag],
          targetWorldSpacePos: retreatPosition,
        };
      }
    }

    // If no valid retreat position is found or unit.tag is undefined, return undefined or handle accordingly
    return undefined;
  }

  /**
   * Determines the best pathable retreat point for the unit.
   * 
   * @param {World} world - The game world.
   * @param {Unit} unit - The unit to retreat.
   * @param {Unit} targetUnit - The unit to retreat from.
   * @param {number} travelDistancePerStep - Distance traveled per step.
   * @returns {Point2D | undefined} - The best pathable retreat point, or undefined.
   */
  determineBestRetreatPoint(world, unit, targetUnit, travelDistancePerStep) {
    const { resources } = world;
    const { map } = resources.get();
    const { pos } = unit;
    const { pos: targetPos } = targetUnit;

    // Return early if positions are undefined.
    if (!pos || !targetPos) return undefined;

    let retreatPoint;

    retreatPoint = this.getBestRetreatCandidatePoint(world, unit, targetUnit);
    if (retreatPoint) return retreatPoint;

    const retreatCandidates = getRetreatCandidates(world, unit, targetUnit);
    retreatPoint = getPathRetreatPoint(resources, unit, retreatCandidates);
    if (retreatPoint) return retreatPoint;

    retreatPoint = this.findClosestSafePosition(world, unit, targetUnit, travelDistancePerStep);
    if (retreatPoint) return retreatPoint;

    return moveAwayPosition(map, targetPos, pos, travelDistancePerStep);
  }

  /**
   * @param {World} world
   * @param {Unit} unit 
   * @param {Unit} targetUnit 
   * @param {number} radius
   * @returns {Point2D|undefined}
   */
  findClosestSafePosition(world, unit, targetUnit, radius = 1) {
    const { resources } = world;
    const { units } = resources.get();
    const safePositions = getSafePositions(world, unit, targetUnit, radius);
    const { pos } = unit; if (pos === undefined) return;

    // Derive safetyRadius based on unit and potential threats
    const safetyRadius = deriveSafetyRadius(world, unit, units.getAlive(Alliance.ENEMY));

    // Filter the safe positions to avoid positions too close to enemy units
    const trulySafePositions = safePositions.filter(position => isTrulySafe(world, position, safetyRadius));

    // Return early if no safe positions are found
    if (trulySafePositions.length === 0) return;

    // If the unit is flying, simply get the closest position
    if (unit.isFlying) {
      const [closestPoint] = getClosestPosition(pos, trulySafePositions);
      return closestPoint;
    }

    // If the unit has a current destination, find the closest position by path
    const currentDestination = unitResourceService.getOrderTargetPosition(units, unit);
    if (currentDestination !== undefined) {
      const [closestPoint] = pathFindingService.getClosestPositionByPath(resources, currentDestination, trulySafePositions);
      return closestPoint;
    }

    // Fallback mechanism: Return closest position based on simple distance if no other criteria are met
    const [fallbackPosition] = getClosestPosition(pos, trulySafePositions);
    return fallbackPosition;
  }  

  /**
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @returns {Point2D | undefined}
   */
  getBestRetreatCandidatePoint(world, unit, targetUnit) {
    const retreatCandidates = getRetreatCandidates(world, unit, targetUnit);
    if (!retreatCandidates || retreatCandidates.length === 0) return;

    return retreatCandidates.find(candidate => candidate.safeToRetreat)?.point;
  }  

  /**
   * Determines the retreat point for a given unit based on the surrounding threats and conditions.
   * 
   * @param {World} world - The world context containing data and resources.
   * @param {Unit} unit - The unit that is considering retreating.
   * @param {Unit[]} targetUnits - The potential threat units.
   * @param {boolean} [toCombatRally=true] - Flag indicating whether to retreat to a combat rally point.
   * 
   * @returns {Point2D|undefined} The point to which the unit should retreat, or undefined if no retreat is needed.
   */
  retreat(world, unit, targetUnits = [], toCombatRally = true) {
    const { data, resources } = world;
    const { map } = resources.get();
    const { pos } = unit;

    if (!pos || targetUnits.length === 0) return;

    const filterRadius = 16;
    const threats = targetUnits
      .filter(target =>
        target.pos &&
        target.unitType !== undefined &&
        getDistanceBetween(pos, target.pos) <= filterRadius)
      .map(target => {
        const weapon = typeof target.unitType === 'number' ?
          unitService.getWeaponThatCanAttack(data, target.unitType, unit) : null;

        return weapon && weapon.range ? { unit: target, weapon, attackRange: weapon.range } : null;
      })
      .filter(Boolean);

    if (threats.length === 0) return;

    threats.sort((a, b) => {
      if (a && b) {
        return b.attackRange - a.attackRange;
      }
      return 0;
    });

    const primaryThreat = threats[0];
    if (!primaryThreat) return;

    const travelDistancePerStep = 2 * getTravelDistancePerStep(map, unit);

    // Define targetPositions based on the positions of threat units
    const targetPositions = threats.reduce((/** @type {Point2D[]} */ positions, threat) => {
      if (threat && threat.unit.pos) {
        positions.push(threat.unit.pos);
      }
      return positions;
    }, []);

    let retreatPoint;

    if (this.shouldRetreatToCombatRally(world, unit, primaryThreat.unit, toCombatRally, travelDistancePerStep)) {
      retreatPoint = getCombatRally(resources);
    } else if (shouldRetreatToBunker(resources, pos)) {
      retreatPoint = getClosestBunkerPosition(resources, pos) || undefined;
    } else {
      retreatPoint = targetPositions.length > 1
        ? moveAwayFromMultiplePositions(map, targetPositions, pos)
        : this.determineBestRetreatPoint(world, unit, primaryThreat.unit, travelDistancePerStep);
    }

    // Check if the retreat point is pathable
    if (retreatPoint && !map.isPathable(retreatPoint)) {
      this.loggingService.logActionIfNearPosition(world, unit, `Unpathable retreat point for unit: ${unit.tag} at position: ${JSON.stringify(retreatPoint)}`);
      return undefined;
    }

    return retreatPoint;
  }

  /**
   * @param {World} world
   * @param {Unit} unit
   * @param {Unit} targetUnit
   * @param {boolean} toCombatRally
   * @param {number} travelDistancePerStep
   * @returns {boolean}
   */
  shouldRetreatToCombatRally(world, unit, targetUnit, toCombatRally, travelDistancePerStep) {
    if (!toCombatRally || !unit.pos || !targetUnit.pos || !targetUnit.unitType) return false;

    const { resources } = world;
    const { map, units } = resources.get();
    const combatRally = getCombatRally(resources);

    // Check if we're stronger at the combatRally position
    if (!isStrongerAtPosition(world, combatRally)) return false;

    const unitToCombatRallyDistance = pathFindingService.getDistanceByPath(resources, unit.pos, combatRally);
    if (unitToCombatRallyDistance <= travelDistancePerStep || unitToCombatRallyDistance === Infinity) return false;

    const targetUnitToCombatRallyDistance = pathFindingService.getDistanceByPath(resources, targetUnit.pos, combatRally);
    if (unitToCombatRallyDistance > targetUnitToCombatRallyDistance) return false;

    const bunkerPositions = units.getById(UnitType.BUNKER).reduce((/** @type {Point2D[]} */acc, unit) => {
      if (unit.buildProgress === 1 && unit.pos) {
        acc.push(unit.pos);
      }
      return acc;
    }, []);

    const [closestBunkerPositionByPath] = getClosestPositionByPathSorted(resources, unit.pos, bunkerPositions);

    const distanceFromCombatRallyToUnit = pathFindingService.getDistanceByPath(resources, combatRally, unit.pos);
    const distanceFromBunkerToUnit = closestBunkerPositionByPath ? pathFindingService.getDistanceByPath(resources, closestBunkerPositionByPath.point, unit.pos) : Infinity;
    if (distanceFromCombatRallyToUnit >= distanceFromBunkerToUnit) return false;

    const pathToRally = MapResourceService.getMapPath(map, unit.pos, combatRally);
    return isSafePathToRally(world, unit, pathToRally);
  }  
}

module.exports = RetreatManagementService;

/**
 * @param {ResourceManager} resources
 * @param {Unit} unit
 * @param {import('../../../../interfaces/retreat-candidate').RetreatCandidate[]} retreatCandidates
 * @returns {Point2D | undefined}
 */
const getPathRetreatPoint = (resources, unit, retreatCandidates) => {
  const { pos } = unit; if (pos === undefined) return;
  const retreatPoints = gatherRetreatPoints(retreatCandidates);
  if (!retreatPoints || retreatPoints.length === 0) return;

  const retreatMap = new Map(retreatPoints.map(retreat => [retreat.point, retreat]));
  const pointsArray = retreatPoints.map(retreat => retreat.point);
  const [largestPathDifferencePoint] = getClosestPositionByPathSorted(resources, pos, pointsArray);

  if (largestPathDifferencePoint) {
    const largestPathDifferenceRetreat = retreatMap.get(largestPathDifferencePoint.point);
    if (largestPathDifferenceRetreat) {
      logExpansionInPath(resources, unit, largestPathDifferenceRetreat);
      return largestPathDifferenceRetreat.point;
    }
  }
}

/**
 * @param {import('../../../../interfaces/retreat-candidate').RetreatCandidate[]} retreatCandidates
 * @returns {{ point: Point2D; expansionsInPath: Point2D[]; }[]}
 */
const gatherRetreatPoints = (retreatCandidates) => {
  return retreatCandidates.reduce((/** @type {{ point: Point2D; expansionsInPath: Point2D[]; }[]}} */acc, retreat) => {
    if (retreat?.point) {
      acc.push({
        point: retreat.point,
        expansionsInPath: retreat.expansionsInPath
      });
    }
    return acc;
  }, []);
}

const logExpansionInPath = (/** @type {ResourceManager} */ resources, /** @type {Unit} */ unit, /** @type {{ point?: Point2D; expansionsInPath: any; }} */ retreat) => {
  const timeInSeconds = getTimeInSeconds(resources.get().frame.getGameLoop());
  if (unit.isWorker() && timeInSeconds > 100 && timeInSeconds < 121) {
    console.log('expansionsInPath', retreat.expansionsInPath);
  }
}

/**
 * @param {ResourceManager} resources
 * @param {SC2APIProtocol.Point} pos
 * @param {SC2APIProtocol.Point[]} mapPoints
 */
function getClosestPositionByPathSorted(resources, pos, mapPoints) {
  const { map } = resources.get();
  return mapPoints.map(point => {
    const [closestPathablePosition] = pathFindingService.getClosestPositionByPath(resources, pos, MapResourceService.getPathablePositions(map, point));
    return {
      point,
      distanceByPath: pathFindingService.getDistanceByPath(resources, pos, closestPathablePosition)
    };
  }).sort((a, b) => a.distanceByPath - b.distanceByPath);
}


/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @param {number} radius
 * @returns {Point2D[]}
 **/
function getSafePositions(world, unit, targetUnit, radius = 0.5) {
  const { resources } = world;
  const { map, units } = resources.get();
  let safePositions = [];
  const { pos } = unit; if (pos === undefined || radius === undefined) return safePositions;
  const { x, y } = pos; if (x === undefined || y === undefined) return safePositions;
  const { pos: targetPos } = targetUnit; if (targetPos === undefined) return safePositions;
  const { x: targetX, y: targetY } = targetPos; if (targetX === undefined || targetY === undefined) return safePositions;
  const enemyUnits = enemyTrackingService.mappedEnemyUnits.filter(enemyUnit => {
    // Check if the unit has a position and is not a peaceful worker
    if (!enemyUnit.pos || enemyTrackingService.isPeacefulWorker(resources, enemyUnit)) {
      return false;
    }

    // Check if the unit is within a certain range
    if (getDistance(pos, enemyUnit.pos) > 16) {
      return false;
    }

    // Check if the unit can attack the worker
    return canAttack(enemyUnit, unit);
  });

  // get the angle to the target enemy unit
  let angleToEnemy = Math.atan2(targetY - y, targetX - x);
  let startAngle = angleToEnemy + Math.PI - Math.PI / 2; // 180 degree cone
  let endAngle = angleToEnemy + Math.PI + Math.PI / 2;

  while (safePositions.length === 0 && radius <= 16) {
    for (let i = startAngle; i < endAngle; i += 2.5 * Math.PI / 180) {  // Half the original step size
      const { x, y } = pos;
      if (x === undefined || y === undefined) return safePositions;
      const point = {
        x: x + radius * Math.cos(i),
        y: y + radius * Math.sin(i),
      };
      if (existsInMap(map, point) && map.isPathable(point)) {
        const [closestEnemyUnit] = units.getClosest(point, enemyUnits, 1);
        if (closestEnemyUnit && closestEnemyUnit.pos && getDistance(point, closestEnemyUnit.pos) > getDistance(pos, closestEnemyUnit.pos)) {
          const pointWithHeight = { ...point, z: map.getHeight(point) };
          const safePositionFromTargets = isSafePositionFromTargets(map, unit, enemyUnits, pointWithHeight);
          if (safePositionFromTargets) {
            safePositions.push(point);
          }
        }
      }
    }
    radius += 0.5;  // Increment radius by smaller steps
  }

  // Get the worker's destination
  const workerDestination = unitResourceService.getOrderTargetPosition(units, unit);

  // If workerDestination is defined, then sort the safe positions based on their proximity to the worker's destination
  if (workerDestination) {
    safePositions.sort((a, b) => {
      const distanceA = getDistance(a, workerDestination);
      const distanceB = getDistance(b, workerDestination);
      return distanceA - distanceB; // Sorting in ascending order of distance to worker's destination
    });
  }

  return safePositions;
}

/**
 * Derives a safety radius based on the unit's characteristics and potential threats
 * @param {World} world
 * @param {Unit} unit
 * @param {Array<Unit>} potentialThreats
 * @returns {number}
 */
const deriveSafetyRadius = (world, unit, potentialThreats) => {
  const { data, resources } = world;
  const { map } = resources.get();
  let baseSafetyRadius = 0
  let maxThreatRange = 0;

  for (let threat of potentialThreats) {
    const { radius, unitType } = threat; if (radius === undefined || unitType === undefined) continue;
    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit); if (weapon === undefined) continue;
    const threatRange = weapon.range || 0;
    if (threatRange > maxThreatRange) {
      maxThreatRange = threatRange + radius + getTravelDistancePerStep(map, threat);
    }
  }

  const { radius } = unit; if (radius === undefined) return baseSafetyRadius;
  baseSafetyRadius += maxThreatRange + radius + getTravelDistancePerStep(map, unit);
  return baseSafetyRadius;
}

/**
 * Utility function to check if a position is truly safe based on all known threats
 * @param {World} world
 * @param {Point2D} position
 * @param {number} safetyRadius - Defines how close a threat can be to consider a position unsafe
 * @returns {boolean}
 */
const isTrulySafe = (world, position, safetyRadius) => {
  const { units } = world.resources.get();

  for (let potentialThreat of units.getAlive(Alliance.ENEMY)) {
    const { pos } = potentialThreat; if (pos === undefined) continue;
    if (getDistance(position, pos) <= safetyRadius) {
      return false;
    }
  }
  return true;
}

/**
 * @param {MapResource} map
 * @param {Unit} unit 
 * @param {Unit[]} targetUnits
 * @param {Point3D} point 
 * @returns {boolean}
 */
function isSafePositionFromTargets(map, unit, targetUnits, point) {
  const { getHighestRangeWeapon } = unitService;
  if (!existsInMap(map, point)) return false;
  let weaponTargetType = null;
  const { pos, radius } = unit;
  if (pos === undefined || radius === undefined) return false;
  if (point.z === undefined || pos === undefined || pos.z === undefined) return false;
  if (point.z > pos.z + 2) {
    weaponTargetType = WeaponTargetType.AIR;
  } else {
    weaponTargetType = WeaponTargetType.GROUND;
    // return false if point is outside of map and point is not pathable
    if (!map.isPathable(point)) return false;
  }
  return targetUnits.every((targetUnit) => {
    const { pos } = targetUnit;
    if (pos === undefined || targetUnit.radius === undefined) return true;
    const weapon = getHighestRangeWeapon(targetUnit, weaponTargetType);
    if (weapon === undefined || weapon.range === undefined) return true;
    const weaponRange = weapon.range;
    const distanceToTarget = getDistance(point, pos);
    const safeDistance = (weaponRange + radius + targetUnit.radius + getTravelDistancePerStep(map, targetUnit) + getTravelDistancePerStep(map, unit));
    return distanceToTarget > safeDistance;
  });
}


/**
 * @param {World} world
 * @param {Unit} unit
 * @param {number[][]} pathToRally
 * @returns {boolean}
 */
function isSafePathToRally(world, unit, pathToRally) {
  const { pos: unitPos } = unit;
  if (!unitPos) return false;

  const { data, resources } = world;
  const { units } = resources.get();

  const aliveEnemies = enemyTrackingService.mappedEnemyUnits;
  if (!aliveEnemies.length) return true;

  return !getPathCoordinates(pathToRally).some(point => {
    const closestEnemies = units.getClosest(point, aliveEnemies);
    if (!closestEnemies.length) return false;

    const closestEnemy = closestEnemies[0];
    const { radius: enemyRadius, tag: enemyTag, unitType: enemyType, pos: enemyPos } = closestEnemy;

    if (!enemyPos || typeof enemyType !== 'number') return false;

    const targetPositions = enemyTag ? enemyTrackingServiceV2.enemyUnitsPositions.get(enemyTag) : null;
    const projectedTargetPosition = targetPositions ?
      getProjectedPosition(
        targetPositions.current.pos,
        targetPositions.previous.pos,
        targetPositions.current.lastSeen,
        targetPositions.previous.lastSeen
      ) : enemyPos;

    if (!projectedTargetPosition) return false;

    const weapon = unitService.getWeaponThatCanAttack(data, enemyType, unit);
    const attackRange = weapon?.range;
    if (!attackRange) return false;

    const effectiveAttackRange = attackRange + (unit.radius || 0) + (enemyRadius || 0);
    const distanceSquared = getDistanceSquared(point, projectedTargetPosition);

    if (distanceSquared <= effectiveAttackRange * effectiveAttackRange) {

      const directionToEnemy = subtractVectors(projectedTargetPosition, unitPos);
      const directionOfMovement = subtractVectors(point, unitPos);
      const currentTime = world.resources.get().frame.timeInSeconds();

      if (currentTime >= 194 && currentTime <= 198) {
        console.log(`Time: ${currentTime}, UnitPos: ${JSON.stringify(unit.pos)}, PathLength: ${pathToRally.length}, ClosestEnemyPos: ${JSON.stringify(closestEnemy.pos)}, AliveEnemies: ${aliveEnemies.length}, ProjectedEnemyPos: ${JSON.stringify(projectedTargetPosition)}, EffectiveAttackRange: ${effectiveAttackRange}, DistanceSquared: ${distanceSquared}, Weapon: ${JSON.stringify(weapon)}, DotVectorsResult: ${dotVectors(directionToEnemy, directionOfMovement)}`);
      }
      return dotVectors(directionToEnemy, directionOfMovement) < 0;
    }

    return false;
  });
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} pos
 * @param {number} thresholdDistance
 * @returns {boolean}
 */
const shouldRetreatToBunker = (resources, pos, thresholdDistance = 16) => {
  const { units } = resources.get();
  const bunkerPositions = getBunkerPositions(units);
  if (bunkerPositions.length === 0) return false;

  const [closestBunker] = pathFindingService.getClosestPositionByPath(resources, pos, bunkerPositions);
  if (!closestBunker) return false;
  const distanceToClosestBunker = pathFindingService.getDistanceByPath(resources, pos, closestBunker);

  // Only retreat to bunker if it's within a certain threshold distance.
  return distanceToClosestBunker < thresholdDistance;
}

/**
 * @param {UnitResource} units
 * @returns {Point2D[]}
 */
const getBunkerPositions = (units) => {
  return units.getById(UnitType.BUNKER)
    .filter(unit => unit.buildProgress === 1 && unit.pos)
    .reduce((/** @type {Point2D[]} */acc, unit) => {
      const { pos } = unit;
      if (pos) acc.push(pos);
      return acc;
    }, []);
}

/**
 * Gets the closest bunker position from the provided position.
 * @param {ResourceManager} resources - The resources object.
 * @param {Point2D} pos - The position from which the distance needs to be calculated.
 * @returns {Point2D | null} - The position of the closest bunker or null if no bunker is found.
 */
const getClosestBunkerPosition = (resources, pos) => {
  const { units } = resources.get();
  const bunkerUnits = units.getById(UnitType.BUNKER).filter(unit => unit.buildProgress === 1 && unit.pos);

  if (bunkerUnits.length === 0) {
    return null;
  }

  const bunkerPositions = bunkerUnits.map(unit => unit.pos);
  const distances = bunkerPositions.map(bunkerPos => {
    if (bunkerPos) {
      return pathFindingService.getDistanceByPath(resources, pos, bunkerPos);
    }
    return Infinity;  // or some other default value indicating an undefined position
  });

  const minDistanceIndex = distances.indexOf(Math.min(...distances));

  const bunkerPosition = bunkerUnits[minDistanceIndex].pos;
  return bunkerPosition ? bunkerPosition : null;
}

/**
 * Return position away from multiple target positions.
 * @param {MapResource} map
 * @param {Point2D[]} targetPositions 
 * @param {Point2D} position 
 * @param {number} distance 
 * @param {boolean} isFlyingUnit 
 * @returns {Point2D | undefined}
 */
function moveAwayFromMultiplePositions(map, targetPositions, position, distance = 2, isFlyingUnit = false) {
  if (targetPositions.length === 0 || position.x === undefined || position.y === undefined) return;

  // Calculate the average threat direction
  let avgDX = 0;
  let avgDY = 0;
  for (const target of targetPositions) {
    if (target.x !== undefined && target.y !== undefined) {
      avgDX += target.x - position.x;
      avgDY += target.y - position.y;
    }
  }
  avgDX /= targetPositions.length;
  avgDY /= targetPositions.length;

  // Compute the point moving away from the threat direction
  const awayPoint = {
    x: position.x - avgDX * distance,
    y: position.y - avgDY * distance
  };

  const { x: mapWidth, y: mapHeight } = map.getSize();

  if (typeof mapWidth === 'undefined' || typeof mapHeight === 'undefined') {
    console.error("Map dimensions are undefined");
    return;
  }

  const clampedPoint = positionService.clampPointToBounds(awayPoint, 0, mapWidth, 0, mapHeight);

  // Skip pathability check for flying units
  if (isFlyingUnit) {
    return clampedPoint;
  }

  return map.isPathable(clampedPoint) ? clampedPoint : positionService.findPathablePointByAngleAdjustment(map, position, avgDX, avgDY);
}

/**
 * @param {World} world
 * @param {Unit} unit
 * @param {Unit} targetUnit
 * @returns {import('../../../../interfaces/retreat-candidate').RetreatCandidate[]}
 */
function getRetreatCandidates(world, unit, targetUnit) {
  const { data, resources } = world;
  const { map } = resources.get();
  const { centroid } = map.getMain();
  const { pos, radius: unitRadius = 0 } = unit;

  if (!centroid || !pos) return [];

  const expansionLocations = getCentroids(map.getExpansions());
  const damageDealingEnemies = this.getDamageDealingUnits(
    world,
    unit,
    targetUnit['selfUnits'] || enemyTrackingService.getEnemyUnits(targetUnit)
  );

  if (damageDealingEnemies.length === 0) {
    const safeExpansionLocations = expansionLocations.filter(location => isPathSafe(world, unit, location));
    return safeExpansionLocations.length > 0 ? mapToRetreatCandidates(resources, safeExpansionLocations, pos) : [];
  }

  const unitsFromClustering = this.getUnitsFromClustering(damageDealingEnemies);

  const retreatCandidates = expansionLocations.flatMap(point => {
    const closestEnemy = enemyTrackingService.getClosestEnemyByPath(resources, point, unitsFromClustering);
    if (!closestEnemy?.unitType || !closestEnemy.pos) return [];

    const weapon = unitService.getWeaponThatCanAttack(data, closestEnemy.unitType, unit);
    const attackRange = (weapon?.range || 0) + unitRadius + (closestEnemy.radius || 0);

    const adjustedDistanceToEnemy = calculateAdjustedDistance(resources, point, closestEnemy.pos, attackRange);
    const distanceToRetreat = calculateDistanceToRetreat(resources, pos, point);

    if (distanceToRetreat !== Infinity && distanceToRetreat < adjustedDistanceToEnemy &&
      isSafeToRetreat(world, unit, getRetreatPath(world, map, pos, point), point)) {
      return mapToRetreatCandidates(resources, [point], pos);
    }
    return [];
  });

  return retreatCandidates;
}

/**
 * @param {Expansion[]} expansions
 * @returns {Point2D[]}
 */
function getCentroids(expansions) {
  return expansions.reduce((/** @type {Point2D[]} */acc, expansion) => {
    if (expansion.centroid) {
      acc.push(expansion.centroid);
    }
    return acc;
  }, []);
}

/**
 * Check if the path to a given location is safe.
 * 
 * @param {World} world - The game world containing various game state information.
 * @param {Unit} unit - The unit that we're considering moving.
 * @param {Point2D} location - The destination point that we're evaluating the safety of reaching.
 * @returns {boolean} - Returns true if the path is deemed safe, and false otherwise.
 */
const isPathSafe = (world, unit, location) => {
  const { resources } = world;
  const { map } = resources.get();
  const { pos: unitPos } = unit;

  if (!unitPos) return false;

  // Obtain the path using your existing getMapPath function
  const path = MapResourceService.getMapPath(map, unitPos, location);

  // Convert path to an array of Point2D for easier handling
  const pathPoints = path.map(coord => ({ x: coord[0], y: coord[1] }));

  const aliveEnemies = resources.get().units.getAlive(Alliance.ENEMY).filter(e => e.pos);

  if (!aliveEnemies.length) return true; // Return early if there are no live enemies

  return !pathPoints.some(point => {
    const closestEnemies = resources.get().units.getClosest(point, aliveEnemies);

    if (!closestEnemies.length) return false;

    const closestEnemy = closestEnemies[0];
    const { unitType, pos: enemyPos } = closestEnemy;

    if (!enemyPos || typeof unitType !== 'number') return false;

    // Projected position logic can be added here if needed
    // const projectedEnemyPos = getProjectedPosition(...);

    const weapon = unitService.getWeaponThatCanAttack(world.data, unitType, unit);
    const attackRange = weapon?.range;

    if (!attackRange) return false;

    const effectiveAttackRange = attackRange + (unit.radius || 0) + (closestEnemy.radius || 0);
    const distance = getDistance(point, enemyPos);

    if (distance <= effectiveAttackRange) {
      const directionToEnemy = subtractVectors(enemyPos, unitPos);
      const directionOfMovement = subtractVectors(point, unitPos);

      return dotVectors(directionToEnemy, directionOfMovement) < 0;
    }

    return false;
  });
};

/**
 * @param {ResourceManager} resources
 * @param {Point2D[]} expansionLocations
 * @param {Point2D} pos
 * @return {import('../../../../interfaces/retreat-candidate').RetreatCandidate[]}
 */
function mapToRetreatCandidates(resources, expansionLocations, pos) {
  const { map } = resources.get();

  return expansionLocations.map(point => {
    const pathablePositions = MapResourceService.getPathablePositions(map, point);
    const { distance } = calculateDistances(resources, pos, pathablePositions);

    return {
      point,
      safeToRetreat: true,
      expansionsInPath: getCentroids(getExpansionsInPath(map, pos, point)),
      getDistanceByPathToRetreat: distance,
      getDistanceByPathToTarget: distance,
      closerOrEqualThanTarget: true,
    };
  });
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} fromPos
 * @param {Point2D[]} toPoints
 * @returns {{ closestPosition: Point2D; distance: number; }}
 */
function calculateDistances(resources, fromPos, toPoints) {
  const [closestPosition] = pathFindingService.getClosestPositionByPath(resources, fromPos, toPoints);
  const distance = pathFindingService.getDistanceByPath(resources, fromPos, closestPosition);
  return { closestPosition, distance };
}

/**
 * @param {MapResource} map
 * @param {Point2D} unitPos
 * @param {Point2D} point
 * @returns {Expansion[]}
 */
function getExpansionsInPath(map, unitPos, point) {
  const pathCoordinates = getPathCoordinates(MapResourceService.getMapPath(map, unitPos, point));
  const expansions = map.getExpansions();

  if (expansions.length === 0) return [];

  const pathCoordinatesBoundingBox = getBoundingBox(pathCoordinates);

  const expansionsInPath = expansions.filter(expansion => {
    if (!expansion.areas || !expansion.centroid) return false;

    const areaFill = expansion.areas.areaFill;
    const centroid = expansion.centroid;

    const distanceToPoint = getDistance(point, centroid);
    const distanceToUnitPos = getDistance(unitPos, centroid);

    if (distanceToPoint < 1 || distanceToUnitPos <= 16) return false;

    const areaFillBoundingBox = getBoundingBox(areaFill);

    if (!boundingBoxesOverlap(pathCoordinatesBoundingBox, areaFillBoundingBox)) return false;

    return pointsOverlap(pathCoordinates, areaFill);
  });

  return expansionsInPath;
}

function getBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach(({ x, y }) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  return { minX, minY, maxX, maxY };
}

function boundingBoxesOverlap(box1, box2) {
  return !(box2.minX > box1.maxX ||
    box2.maxX < box1.minX ||
    box2.minY > box1.maxY ||
    box2.maxY < box1.minY);
}

/**
 * Calculates the adjusted distance to the enemy.
 * 
 * @param {any} resources - The resources object from the world.
 * @param {Point2D} point - The point to which the unit might retreat.
 * @param {Point2D} enemyPos - The position of the closest enemy.
 * @param {number} attackRange - The attack range considering both enemy and unit's radius.
 * @returns {number} - The adjusted distance to the enemy.
 */
function calculateAdjustedDistance(resources, point, enemyPos, attackRange) {
  const { map } = resources.get();
  const point2D = { x: enemyPos.x, y: enemyPos.y };
  return calculateDistances(resources, point2D, MapResourceService.getPathablePositions(map, point)).distance - attackRange;
}


/**
 * Calculates the distance to the retreat point.
 * 
 * @param {any} resources - The resources object from the world.
 * @param {Point2D} pos - The current position of the unit.
 * @param {Point2D} point - The point to which the unit might retreat.
 * @returns {number} - The distance to the retreat point.
 */
function calculateDistanceToRetreat(resources, pos, point) {
  const { map } = resources.get();
  return calculateDistances(resources, pos, MapResourceService.getPathablePositions(map, point)).distance;
}

/**
 * Checks whether the retreat path and point are safe based on the allies and enemies near the path and point.
 *
 * @param {World} world - The collection of all units in the game.
 * @param {Unit} unit - The unit we are considering the retreat for.
 * @param {Point2D[]} pathToRetreat - The series of points defining the path to the retreat point.
 * @param {Point2D} retreatPoint - The final retreat point.
 * @returns {boolean} - Returns true if the path and point are safe to retreat to.
 */
function isSafeToRetreat(world, unit, pathToRetreat, retreatPoint) {
  // First, check the safety of the path
  for (let point of pathToRetreat) {
    if (!isPointSafe(world, unit, point)) {
      return false;  // Unsafe path segment found
    }
  }

  // Then, check the safety of the retreat point itself
  return isPointSafe(world, unit, retreatPoint);
}

/**
 * Helper function that checks the safety of a specific point.
 *
 * @param {World} world - The collection of all units in the game.
 * @param {Unit} unit - The unit we are considering the safety for.
 * @param {Point2D} point - The point to check.
 * @returns {boolean} - Returns true if the point is safe.
 */
function isPointSafe(world, unit, point) {
  if (!unit.pos) {
    return false;
  }

  const { data } = world;
  const directionOfMovement = subtractVectors(point, unit.pos);
  const unitRadius = unit.radius || 0;

  for (const enemy of enemyTrackingServiceV2.mappedEnemyUnits) {
    const { radius = 0, tag: enemyTag, unitType, pos: enemyPos } = enemy; // Default to 0 if radius is undefined

    if (!enemyPos || typeof unitType !== 'number') continue;

    const targetPositions = enemyTag && enemyTrackingServiceV2.enemyUnitsPositions.get(enemyTag);
    const projectedTargetPosition = targetPositions ? getProjectedPosition(
      targetPositions.current.pos,
      targetPositions.previous.pos,
      targetPositions.current.lastSeen,
      targetPositions.previous.lastSeen
    ) : enemyPos;

    if (!projectedTargetPosition) continue;

    const weapon = unitService.getWeaponThatCanAttack(data, unitType, unit);
    if (!weapon?.range) continue;

    const effectiveAttackRange = weapon.range + unitRadius + radius;
    const distanceSquared = getDistanceSquared(point, projectedTargetPosition);
    const directionToEnemy = subtractVectors(projectedTargetPosition, unit.pos);

    if (dotVectors(directionToEnemy, directionOfMovement) > 0 && distanceSquared <= effectiveAttackRange * effectiveAttackRange) {
      return false;
    }
  }

  const alliesAtPoint = getUnitsInRangeOfPosition(trackUnitsService.selfUnits, point, 16).filter(ally => !ally.isWorker());
  const enemiesNearUnit = getUnitsInRangeOfPosition(enemyTrackingServiceV2.mappedEnemyUnits, point, 16);

  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, alliesAtPoint, enemiesNearUnit);

  return timeToKill < timeToBeKilled;
}

/**
 * @param {Unit[]} units
 * @param {Point2D} position
 * @param {number} range
 * @returns {Unit[]}
 */
function getUnitsInRangeOfPosition(units, position, range) {
  return units.filter(unit => {
    const { pos } = unit; if (pos === undefined) return false;
    return getDistance(pos, position) <= range;
  });
}

/**
 * Retrieves the path to the retreat point, considering pathable positions.
 * 
 * @param {any} world - The world object containing data and resources.
 * @param {any} map - The map object from the resources.
 * @param {Point2D} pos - The current position of the unit.
 * @param {Point2D} point - The point to which the unit might retreat.
 * @returns {Point2D[]} - The array of pathable positions leading to the retreat point.
 */
function getRetreatPath(world, map, pos, point) {
  const expansionsInPath = getExpansionsInPath(map, pos, point);
  return expansionsInPath.reduce((/** @type {Point2D[]} */acc, expansion) => {
    const position = map.isPathable(expansion.townhallPosition)
      ? expansion.townhallPosition
      : findNearbyPathablePosition(world, expansion.townhallPosition);
    if (position) acc.push(position);
    return acc;
  }, []);
}

/**
 * Returns a nearby pathable position given an unpathable position.
 *
 * @param {World} world - The game world data.
 * @param {Point2D} unpathablePoint - The unpathable position.
 * @param {number} maxSearchRadius - The maximum radius to search for a pathable point.
 * @returns {Point2D | undefined} - A nearby pathable position or undefined if none found.
 */
function findNearbyPathablePosition(world, unpathablePoint, maxSearchRadius = 5) {
  if (unpathablePoint.x === undefined || unpathablePoint.y === undefined) {
    return undefined; // Or throw an error, depending on your use case
  }

  const { map } = world.resources.get();
  for (let r = 1; r <= maxSearchRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
          continue; // Only consider points on the outer perimeter of the search area
        }
        const testPoint = {
          x: unpathablePoint.x + dx,
          y: unpathablePoint.y + dy
        };
        if (map.isPathable(testPoint)) {
          return testPoint;
        }
      }
    }
  }
  return undefined;
}