//@ts-check
"use strict"

// External library imports from @node-sc2/core
const { Ability, Buff, UnitType } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const getRandom = require("@node-sc2/core/utils/get-random");

// Internal utility function imports
// eslint-disable-next-line no-unused-vars
const GameState = require("./core/gameState");
const { getDistance } = require("./geometryUtils");
const { dbscan, getGasGeysers } = require("./mapUtils");
const { flyingTypesMapping } = require("./unitConfig");
const { setPendingOrders } = require("./unitOrders");
const { createUnitCommand } = require("./utils");
const { getPendingOrders } = require("./utils/gameLogic/commonGameUtils");
const { getClosestPathablePositionsBetweenPositions } = require("./utils/gameLogic/sharedPathfindingUtils");

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
 * @param {World} world 
 * @param {AbilityId} abilityId 
 * @param {(data: DataStorage, unit: Unit) => boolean} isIdleOrAlmostIdleFunc - Function to check if a unit is idle or almost idle.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function ability(world, abilityId, isIdleOrAlmostIdleFunc) {
  const { data, resources } = world;
  const { units } = resources.get();

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
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
 * @param {{point: Point2D, unit: Unit}[]} pointsWithUnits
 * @param {number} eps
 * @param {number} minPts
 * @returns {{center: Point2D, units: Unit[]}[]}
 */
function dbscanWithUnits(pointsWithUnits, eps = 1.5, minPts = 1) {
  /** @type {{center: Point2D, units: Unit[]}[]} */
  let clusters = [];
  let visited = new Set();
  let noise = new Set();

  /**
   * Finds points within the specified distance (eps) of point p.
   * @param {Point2D} p - The point to query around.
   * @returns {{point: Point2D, unit: Unit}[]}
   */
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
 * @param {Unit} unit
 * @param {number} buildTime
 * @param {number} progress
 * @returns {number}
 **/
function getBuildTimeLeft(unit, buildTime, progress) {
  const { buffIds } = unit;
  if (buffIds === undefined) return buildTime;
  if (buffIds.includes(Buff.CHRONOBOOSTENERGYCOST)) {
    buildTime = buildTime * 2 / 3;
  }
  return Math.round(buildTime * (1 - progress));
}

// Export the shared functions
module.exports = {
  SPEED_MODIFIERS,
  ability,
  dbscanWithUnits,
  getClosestExpansion,
  getUnitsFromClustering,
  isMoving,
  getClosestPathWithGasGeysers,
  getBuildTimeLeft,
};
