//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { Ability, Buff, UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const { avgPoints } = require("@node-sc2/core/utils/geometry/point");
const getRandom = require("@node-sc2/core/utils/get-random");

// Internal utility function imports
const { setPendingOrders } = require("./common");
// eslint-disable-next-line no-unused-vars
const GameState = require("./gameState");
const { getClosestPosition, getDistance } = require("./geometryUtils");
const { dbscan, getGasGeysers } = require("./mapUtils");
const { getClosestPositionByPath } = require("./pathfinding");
const { getPathablePositions, checkIfPositionIsCorner, getPathCoordinates, getMapPath } = require("./pathUtils");
const { getStructureCells } = require("./placementPathfindingUtils");
const { flyingTypesMapping, getMovementSpeedByType, ZERG_UNITS_ON_CREEP_BONUS } = require("./unitConfig");
const { createUnitCommand, getDistanceByPath } = require("./utils");

/** @type {(unit: Unit, gameState: GameState) => number} */
const zealotModifier = (unit, gameState) => (
  unit.alliance === Alliance.ENEMY && gameState.enemyCharge
) ? 0.5 : 0;

/** @type {(unit: Unit, gameState: GameState) => number} */
const zerglingModifier = (unit, gameState) => {
  const enemyMetabolicBoost = gameState.getEnemyMetabolicBoostState(); // Assuming this method exists in GameState
  return (unit.alliance === Alliance.ENEMY && enemyMetabolicBoost) ? (4.69921875 / 2.9351) - 1 : 0;
};

/** @type Map<UnitTypeId, (unit: Unit, gameState: GameState) => number> */
const SPEED_MODIFIERS = new Map([
  [UnitType.ZEALOT, (/** @type {Unit} */ unit, /** @type {GameState} */ gameState) => zealotModifier(unit, gameState)],
  [UnitType.ZERGLING, zerglingModifier],
]);

/**
 * Calculates the distance between two points.
 * @param {Point2D} pointA - First point.
 * @param {Point2D} pointB - Second point.
 * @returns {number} - The distance between the two points or a default value if either point is incomplete.
 */
function calculateDistance(pointA, pointB) {
  // Check if both points have defined 'x' and 'y' values
  if (typeof pointA.x === 'number' && typeof pointA.y === 'number' &&
    typeof pointB.x === 'number' && typeof pointB.y === 'number') {
    return Math.sqrt(Math.pow(pointA.x - pointB.x, 2) + Math.pow(pointA.y - pointB.y, 2));
  } else {
    // Handle the case where one or more coordinates are undefined
    // This could be returning a default value or throwing an error
    console.error('Invalid points provided for distance calculation');
    return 0; // Returning 0 or any default value you deem appropriate
  }
}


/**
 * Finds the closest expansion to a given position.
 * @param {MapResource} map - The map resource object from the bot.
 * @param {Point2D} position - The position to compare against expansion locations.
 * @returns {Expansion | undefined} The closest expansion, or undefined if not found.
 */
function getClosestExpansion(map, position) {
  const expansions = map.getExpansions();
  if (expansions.length === 0) return undefined;

  return expansions.sort((a, b) => {
    // Use a fallback value (like Number.MAX_VALUE) if getDistance returns undefined
    const distanceA = getDistance(a.townhallPosition, position) || Number.MAX_VALUE;
    const distanceB = getDistance(b.townhallPosition, position) || Number.MAX_VALUE;
    return distanceA - distanceB;
  })[0];
}

/**
 * Retrieves pending orders for a unit.
 * @param {Unit} unit - The unit to retrieve pending orders for.
 * @returns {SC2APIProtocol.UnitOrder[]} An array of pending orders.
 */
function getPendingOrders(unit) {
  return unit['pendingOrders'] || [];
}

/**
 * Cluster units and find the closest unit to each cluster's centroid.
 * @param {Unit[]} units
 * @returns {Unit[]}
 */
const getUnitsFromClustering = (units) => {
  // Perform clustering on builderCandidates
  let unitPoints = units.reduce((/** @type {Point2D[]} */accumulator, builder) => {
    const { pos } = builder; if (pos === undefined) return accumulator;
    accumulator.push(pos);
    return accumulator;
  }, []);
  // Apply DBSCAN to get clusters
  const clusters = dbscan(unitPoints);
  // Find the closest builderCandidate to each centroid
  let closestUnits = clusters.reduce((/** @type {Unit[]} */acc, builderCandidateCluster) => {
    let closestBuilderCandidate;
    let shortestDistance = Infinity;
    for (let unit of units) {
      const { pos } = unit; if (pos === undefined) return acc;
      let distance = getDistance(builderCandidateCluster, pos);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        closestBuilderCandidate = unit;
      }
    }
    if (closestBuilderCandidate) {
      acc.push(closestBuilderCandidate);
    }
    return acc;
  }, []);
  return closestUnits;
};

/**
 * @param {Unit} unit
 * @param {boolean} pending
 * @returns {boolean}
 */
function isMoving(unit, pending = false) {
  const { orders } = unit; if (orders === undefined || orders.length === 0) return false;
  if (pending) {
    /** @type {SC2APIProtocol.UnitOrder[]} */
    const pendingOrders = getPendingOrders(unit);
    orders.concat(pendingOrders);
  }
  return orders.some(order => order.abilityId === Ability.MOVE);
}

/**
 * @param {{point: Point2D, unit: Unit}[]} pointsWithUnits
 * @param {number} eps
 * @param {number} minPts
 * @returns {{center: Point2D, units: Unit[]}[]}
 */
function dbscanWithUnits(pointsWithUnits, eps = 1.5, minPts = 1) {
  let clusters = [];
  let visited = new Set();
  let noise = new Set();

  function rangeQuery(p) {
    return pointsWithUnits.filter(({ point }) => {
      const distance = getDistance(p, point); // Assume getDistance is defined
      return distance <= eps;
    });
  }

  pointsWithUnits.forEach(({ point }) => {
    if (!visited.has(point)) {
      visited.add(point);

      let neighbors = rangeQuery(point);

      if (neighbors.length < minPts) {
        noise.add(point);
      } else {
        let cluster = new Set([point]);

        for (let { point: point2 } of neighbors) {
          if (!visited.has(point2)) {
            visited.add(point2);

            let neighbors2 = rangeQuery(point2);

            if (neighbors2.length >= minPts) {
              neighbors = neighbors.concat(neighbors2);
            }
          }

          if (!Array.from(cluster).includes(point2)) {
            cluster.add(point2);
          }
        }

        const clusterUnits = pointsWithUnits.filter(pt => cluster.has(pt.point)).map(pt => pt.unit);
        const center = {
          x: Array.from(cluster).reduce((a, b) => b.x !== undefined ? a + b.x : a, 0) / cluster.size,
          y: Array.from(cluster).reduce((a, b) => b.y !== undefined ? a + b.y : a, 0) / cluster.size
        };

        clusters.push({ center, units: clusterUnits });
      }
    }
  });

  return clusters;
}

/**
 * Calculates the movement speed of a unit based on various factors.
 * @param {MapResource} map The map resource object.
 * @param {Unit} unit The unit for which to calculate movement speed.
 * @param {GameState} gameState The current game state.
 * @param {boolean} adjustForRealSeconds Adjusts speed for real-time seconds.
 * @returns {number} The movement speed of the unit.
 */
function getMovementSpeed(map, unit, gameState, adjustForRealSeconds = false) {
  const { pos, unitType } = unit;
  if (!pos || !unitType) return 0;

  let movementSpeed = getMovementSpeedByType(unit);
  if (!movementSpeed) return 0;

  // Apply speed modifier specific to the unit type, if any.
  const speedModifierFunc = SPEED_MODIFIERS.get(unitType);
  if (speedModifierFunc) {
    movementSpeed += speedModifierFunc(unit, gameState);
  }

  let multiplier = adjustForRealSeconds ? 1.4 : 1;

  // Apply stimpack buff speed multiplier.
  if (unit.buffIds?.includes(Buff.STIMPACK)) {
    multiplier *= 1.5;
  }

  // Apply speed bonus for Zerg units on creep.
  if (map.hasCreep(pos)) {
    multiplier *= ZERG_UNITS_ON_CREEP_BONUS.get(unitType) || 1.3;
  }

  return movementSpeed * multiplier;
}

/**
 * Get the closest pathable positions between two positions considering various obstacles.
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {Point2D} targetPosition
 * @param {Unit[]} gasGeysers
 * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}}
 */
function getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers = []) {
  const { map, units } = resources.get();
  const mapFixturesToCheck = [
    ...units.getStructures({ alliance: Alliance.SELF }),
    ...units.getStructures({ alliance: Alliance.ENEMY }),
    ...gasGeysers,
  ];

  const structureAtPositionCells = getStructureCells(position, mapFixturesToCheck);
  const structureAtTargetPositionCells = getStructureCells(targetPosition, mapFixturesToCheck);

  // Store the original state of each cell
  const originalCellStates = new Map();
  [...structureAtPositionCells, ...structureAtTargetPositionCells].forEach(cell => {
    originalCellStates.set(cell, map.isPathable(cell));
    map.setPathable(cell, true);
  });

  const pathablePositions = getPathablePositions(map, position);
  const isAnyPositionCorner = checkIfPositionIsCorner(pathablePositions, position);
  const filteredPathablePositions = isAnyPositionCorner && pathablePositions.length === 4
    ? pathablePositions.filter(pos => {
      const { x, y } = pos;
      if (x === undefined || y === undefined) return false;
      const { x: centerX, y: centerY } = position;
      if (centerX === undefined || centerY === undefined) return false;
      return (x > centerX && y > centerY) || (x < centerX && y < centerY);
    })
    : pathablePositions;
  const pathableTargetPositions = getPathablePositions(map, targetPosition);
  const isAnyTargetPositionCorner = checkIfPositionIsCorner(pathableTargetPositions, targetPosition);
  const filteredPathableTargetPositions = isAnyTargetPositionCorner && pathableTargetPositions.length === 4
    ? pathableTargetPositions.filter(pos => {
      const { x, y } = pos;
      if (x === undefined || y === undefined) return false;
      const { x: centerX, y: centerY } = targetPosition;
      if (centerX === undefined || centerY === undefined) return false;
      return (x > centerX && y > centerY) || (x < centerX && y < centerY);
    })
    : pathableTargetPositions;
  const distancesAndPositions = filteredPathablePositions.map(pathablePosition => {
    const distancesToTargetPositions = filteredPathableTargetPositions.map(pathableTargetPosition => {
      return {
        pathablePosition,
        pathableTargetPosition,
        pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
        distance: getDistanceByPath(resources, pathablePosition, pathableTargetPosition)
      };
    });
    if (isAnyPositionCorner || isAnyTargetPositionCorner) {
      const averageDistance = distancesToTargetPositions.reduce((acc, { distance }) => acc + distance, 0) / distancesToTargetPositions.length;
      return {
        pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, targetPosition)),
        pathablePosition,
        pathableTargetPosition: targetPosition,
        distance: averageDistance
      };
    } else {
      return distancesToTargetPositions.reduce((acc, curr) => acc.distance < curr.distance ? acc : curr);
    }
  }).sort((a, b) => a.distance - b.distance);
  let result;
  if (isAnyPositionCorner || isAnyTargetPositionCorner) {
    const averageDistance = distancesAndPositions.reduce((acc, curr) => {
      return acc + curr.distance;
    }, 0) / distancesAndPositions.length;
    const pathablePosition = isAnyPositionCorner ? avgPoints(filteredPathablePositions) : getClosestPosition(position, filteredPathablePositions)[0];
    const pathableTargetPosition = isAnyTargetPositionCorner ? avgPoints(filteredPathableTargetPositions) : getClosestPosition(targetPosition, filteredPathableTargetPositions)[0];
    result = {
      pathCoordinates: getPathCoordinates(getMapPath(map, pathablePosition, pathableTargetPosition)),
      pathablePosition,
      pathableTargetPosition,
      distance: averageDistance
    };
  } else {
    result = distancesAndPositions[0];
  }

  // Restore each cell to its original state
  [...structureAtPositionCells, ...structureAtTargetPositionCells].forEach(cell => {
    const originalState = originalCellStates.get(cell);
    map.setPathable(cell, originalState);
  });

  // return the result after restoring unpathable cells
  return result;
}

/**
 * @param {ResourceManager} resources
 * @param {Point2D} unitPosition
 * @param {Point2D} position
 * @returns {Point2D}
 */
function getClosestUnitPositionByPath(resources, unitPosition, position) {
  const { map } = resources.get();
  const pathablePositions = getPathablePositions(map, unitPosition);
  const [closestPositionByPath] = getClosestPositionByPath(resources, position, pathablePositions);
  return closestPositionByPath;
}

/**
 * Retrieves the closest pathable positions between two points, considering gas geysers.
 * @param {ResourceManager} resources - The resource manager containing map and units data.
 * @param {Point2D} position - The starting position.
 * @param {Point2D} targetPosition - The target position.
 * @returns {{distance: number, pathCoordinates: Point2D[], pathablePosition: Point2D, pathableTargetPosition: Point2D}} - Closest pathable positions and related data.
 */
function getClosestPathWithGasGeysers(resources, position, targetPosition) {
  const { units } = resources.get();
  const gasGeysers = getGasGeysers(units);
  return getClosestPathablePositionsBetweenPositions(resources, position, targetPosition, gasGeysers);
}

/**
 * @param {World} world 
 * @param {AbilityId} abilityId 
 * @param {(data: DataStorage, unit: Unit) => boolean} isIdleOrAlmostIdleFunc - Function to check if a unit is idle or almost idle.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function ability(world, abilityId, isIdleOrAlmostIdleFunc) {
  const { data, resources } = world;
  const { units } = resources.get();
  const collectedActions = [];

  const flyingTypesKeys = [...flyingTypesMapping.keys()];

  let canDoTypes = data.findUnitTypesWithAbility(abilityId)
    .map(unitTypeId => {
      const key = flyingTypesKeys.find(key => flyingTypesMapping.get(key) === unitTypeId);
      return key ? [unitTypeId, key] : [unitTypeId];
    }).flat();

  if (canDoTypes.length === 0) {
    canDoTypes = units.getAlive(Alliance.SELF).reduce((/** @type {UnitTypeId[]} */acc, unit) => {
      if (unit.unitType) {
        acc.push(unit.unitType);
      }
      return acc;
    }, []);
  }

  const unitsCanDo = units.getById(canDoTypes);
  if (!unitsCanDo.length) return collectedActions;

  const unitsCanDoWithAbilityAvailable = unitsCanDo.filter(unit =>
    unit.abilityAvailable(abilityId) && getPendingOrders(unit).length === 0);

  let unitCanDo = getRandom(unitsCanDoWithAbilityAvailable);

  if (!unitCanDo) {
    const idleOrAlmostIdleUnits = unitsCanDo.filter(unit =>
      isIdleOrAlmostIdleFunc(data, unit) && getPendingOrders(unit).length === 0);

    unitCanDo = getRandom(idleOrAlmostIdleUnits);
  }

  if (unitCanDo) {
    const unitCommand = createUnitCommand(abilityId, [unitCanDo]);
    setPendingOrders(unitCanDo, unitCommand);
    if (unitCanDo.abilityAvailable(abilityId)) {
      collectedActions.push(unitCommand);
    }
  }

  return collectedActions;
}

/**
 * @param {Unit} unit
 * @param {number} buildTime
 * @param {number} progress
 * @returns {number}
 **/
function getBuildTimeLeft(unit, buildTime, progress) {
  const { buffIds } = unit;
  if (buffIds === undefined) return buildTime;
  if (buffIds.includes(Buff.CHRONOBOOSTED)) {
    buildTime = buildTime * 2 / 3;
  }
  return Math.round(buildTime * (1 - progress));
}

// Export the shared functions
module.exports = {
  calculateDistance,
  getClosestExpansion,
  getPendingOrders,
  getUnitsFromClustering,
  isMoving,
  dbscanWithUnits,
  getMovementSpeed,
  getClosestPathablePositionsBetweenPositions,
  getClosestUnitPositionByPath,
  getClosestPathWithGasGeysers,
  ability,
  getBuildTimeLeft,
};
