// Import necessary constants, types, and other modules

// External library imports
const { UnitType, Buff, Ability } = require("@node-sc2/core/constants");
const { Alliance } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { cellsInFootprint } = require("@node-sc2/core/utils/geometry/plane");
const { getFootprint } = require("@node-sc2/core/utils/geometry/units");
const getRandom = require("@node-sc2/core/utils/get-random");

// Internal module imports
const MapResources = require("../../../data/mapResources/mapResources");
const { createUnitCommand } = require("../../core/common");
const { getById } = require("../../core/generalUtils");
const { getNeediestMineralField } = require("../../core/resourceUtils");
const { getClosestPathWithGasGeysers } = require("../../core/sharedPathfindingUtils");
const { getMovementSpeed, getWorkerSourceByPath } = require("../../features/shared/coreUtils");
const { getClosestUnitPositionByPath, getStructureAtPosition, getTimeInSeconds, dbscan, areApproximatelyEqual } = require("../../features/shared/pathfinding/pathfinding");
const { getDistanceByPath } = require("../../features/shared/pathfinding/pathfindingCore");
const { getDistance } = require("../../features/shared/pathfinding/spatialCoreUtils");
const { getPendingOrders } = require("../../sharedServices");
const { GameState } = require('../../state');
const { unitTypeTrainingAbilities, flyingTypesMapping } = require("../../units/management/unitConfig");
const { setPendingOrders } = require("../../units/management/unitOrders");

/**
 * Global scope for worker assignment tracking
 * @type {Set<string>}
 */
const reservedWorkers = new Set();
const reservedWorkersByPosition = new Map();

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

  const canDoTypes = data.findUnitTypesWithAbility(abilityId); // Simplified retrieval of unit types with ability

  const unitsCanDo = units.getAlive(Alliance.SELF).filter(unit => unit.unitType !== undefined && canDoTypes.includes(unit.unitType));

  const unitsCanDoWithAbilityAvailable = unitsCanDo.filter(unit =>
    unit.abilityAvailable(abilityId) && getPendingOrders(unit).length === 0
  );

  let unitCanDo = getRandom(unitsCanDoWithAbilityAvailable);

  if (!unitCanDo) {
    const idleOrAlmostIdleUnits = unitsCanDo.filter(unit =>
      isIdleOrAlmostIdleFunc(data, unit) && getPendingOrders(unit).length === 0
    );

    unitCanDo = getRandom(idleOrAlmostIdleUnits);
  }

  if (unitCanDo) {
    const unitCommand = createUnitCommand(abilityId, [unitCanDo]);
    setPendingOrders(unitCanDo, unitCommand);
    collectedActions.push(unitCommand);
  }

  return collectedActions;
}

/**
 * @param {World} world
 * @param {Unit[]} movingOrConstructingNonDrones 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number}[]}
 */
function calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position) {
  const { resources } = world;
  const { map, units } = resources.get();
  const { SCV, SUPPLYDEPOT } = UnitType;

  return movingOrConstructingNonDrones.reduce((/** @type {{unit: Unit, timeToPosition: number}[]} */acc, movingOrConstructingNonDrone) => {
    const { orders, pos, unitType } = movingOrConstructingNonDrone;
    if (orders === undefined || pos === undefined || unitType === undefined) return acc;

    orders.push(...getPendingOrders(movingOrConstructingNonDrone));
    const { abilityId, targetWorldSpacePos, targetUnitTag } = orders[0];
    if (abilityId === undefined || (targetWorldSpacePos === undefined && targetUnitTag === undefined)) return acc;

    const movingPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined;
    const gameState = GameState.getInstance();
    const movementSpeed = getMovementSpeed(map, movingOrConstructingNonDrone, gameState);
    if (movingPosition === undefined || movementSpeed === undefined) return acc;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const isSCV = unitType === SCV;
    const constructingStructure = isSCV ? getStructureAtPosition(units, movingPosition) : undefined;
    constructingStructure && MapResources.setPathableGrids(map, constructingStructure, true);

    const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
    const movingProbeTimeToMovePosition = getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeedPerSecond;

    constructingStructure && MapResources.setPathableGrids(map, constructingStructure, false);

    let buildTimeLeft = 0;
    /** @type {Point2D[]} */
    let supplyDepotCells = [];
    if (isSCV) {
      buildTimeLeft = getConstructionTimeLeft(world, movingOrConstructingNonDrone);
      const isConstructingSupplyDepot = unitTypeTrainingAbilities.get(abilityId) === SUPPLYDEPOT;
      if (isConstructingSupplyDepot) {
        const [supplyDepot] = units.getClosest(movingPosition, units.getStructures().filter(structure => structure.unitType === SUPPLYDEPOT));
        if (supplyDepot !== undefined) {
          const { pos, unitType } = supplyDepot; if (pos === undefined || unitType === undefined) return acc;
          const footprint = getFootprint(unitType); if (footprint === undefined) return acc;
          supplyDepotCells = cellsInFootprint(pos, footprint);
          supplyDepotCells.forEach(cell => map.setPathable(cell, true));
        }
      }
    }

    const pathablePremovingPosition = getClosestUnitPositionByPath(resources, position, pathableMovingPosition);
    const targetTimeToPremovePosition = getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeedPerSecond;
    supplyDepotCells.forEach(cell => map.setPathable(cell, false));

    const timeToPosition = movingProbeTimeToMovePosition + buildTimeLeft + targetTimeToPremovePosition;

    acc.push({
      unit: movingOrConstructingNonDrone,
      timeToPosition: timeToPosition
    });

    return acc;
  }, []);
}

/**
 * @param {{point: Point2D, unit: Unit}[]} pointsWithUnits
 * @param {number} eps
 * @param {number} minPts
 * @returns {{center: Point2D, units: Unit[]}[]}
 */
function dbscanWithUnits(pointsWithUnits, eps = 1.5, minPts = 1) {
  const clusters = [];
  const visited = new Set();
  const noise = new Set();

  /**
   * Finds points within the specified distance (eps) of point p.
   * @param {Point2D} p - The point to query around.
   * @returns {{point: Point2D, unit: Unit}[]}
   */
  function rangeQuery(p) {
    return pointsWithUnits.filter(({ point }) => getDistance(p, point) <= eps);
  }

  for (const { point } of pointsWithUnits) {
    if (visited.has(point)) continue;
    visited.add(point);

    let neighbors = rangeQuery(point);

    if (neighbors.length < minPts) {
      noise.add(point);
    } else {
      const cluster = new Set([point]);

      for (const neighbor of neighbors) {
        const { point: neighborPoint } = neighbor;
        if (!visited.has(neighborPoint)) {
          visited.add(neighborPoint);
          const newNeighbors = rangeQuery(neighborPoint);
          if (newNeighbors.length >= minPts) {
            neighbors = neighbors.concat(newNeighbors);
          }
        }
        cluster.add(neighborPoint);
      }

      const clusterUnits = pointsWithUnits
        .filter(pt => cluster.has(pt.point))
        .map(pt => pt.unit);

      const validPoints = [...cluster].filter(p => p.x !== undefined && p.y !== undefined);
      const center = {
        x: validPoints.reduce((a, b) => a + (b.x || 0), 0) / validPoints.length,
        y: validPoints.reduce((a, b) => a + (b.y || 0), 0) / validPoints.length,
      };

      clusters.push({ center, units: clusterUnits });
    }
  }

  return clusters;
}

/**
 * Filter out builder candidates who are also moving or constructing drones.
 * 
 * @param {Unit[]} builderCandidates - The array of builder candidates.
 * @param {Unit[]} movingOrConstructingNonDrones - The array of drones that are either moving or in construction.
 * @returns {Unit[]} - The filtered array of builder candidates.
 */
function filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones) {
  return builderCandidates.filter(builder => !movingOrConstructingNonDrones.some(movingOrConstructingNonDrone => movingOrConstructingNonDrone.tag === builder.tag));
}

/**
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @returns {Unit[]}
 */
function filterMovingOrConstructingNonDrones(units, builderCandidates) {
  const { PROBE, SCV } = UnitType;

  return units.getWorkers().filter(worker => {
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === SCV;

    return (isConstructingOrMovingProbe || isConstructingSCV) && isNotDuplicate;
  });
}

/**
 * Function to gather builder candidates
 * @param {UnitResource} units
 * @param {Unit[]} builderCandidates
 * @param {Point2D} position
 * @returns {Unit[]}
 */
function gatherBuilderCandidates(units, builderCandidates, position) {
  /** @type {Unit[]} */
  const movingOrConstructingNonDrones = [];
  builderCandidates.push(...units.getWorkers().filter(worker => {
    const { orders } = worker; if (orders === undefined) return false;
    const isNotDuplicate = !builderCandidates.some(builder => builder.tag === worker.tag);
    const gatheringAndNotMining = worker.isGathering() && !isMining(units, worker);
    const isConstructingOrMovingProbe = (isConstructing(worker, true) || isMoving(worker, true)) && worker.unitType === UnitType.PROBE;
    const isConstructingSCV = isConstructing(worker, true) && worker.unitType === UnitType.SCV;
    if (isConstructingOrMovingProbe || isConstructingSCV) movingOrConstructingNonDrones.push(worker);
    const available = (
      worker.noQueue ||
      gatheringAndNotMining ||
      orders.findIndex(order => order.targetWorldSpacePos && (getDistance(order.targetWorldSpacePos, position) < 1)) > -1
    );
    return isNotDuplicate && available;
  }));
  return builderCandidates;
}

/**
 * Get clusters of builder candidate positions
 * @param {Unit[]} builderCandidates 
 * @returns {{center: Point2D, units: Unit[]}[]}
 */
function getBuilderCandidateClusters(builderCandidates) {
  // Prepare data for dbscanWithUnits
  let pointsWithUnits = builderCandidates.reduce((/** @type {{point: Point2D, unit: Unit}[]} */accumulator, builder) => {
    const { pos } = builder;
    if (pos === undefined) return accumulator;
    accumulator.push({ point: pos, unit: builder });
    return accumulator;
  }, []);

  // Apply DBSCAN to get clusters
  let builderCandidateClusters = dbscanWithUnits(pointsWithUnits, 9);

  return builderCandidateClusters;
}

/**
 * Calculates the remaining build time for a unit, considering buffs like Chrono Boost.
 * 
 * @param {Unit} unit - The unit being trained or constructed.
 * @param {number | undefined} buildTime - The base build time of the unit or structure.
 * @param {number} progress - The current build progress of the unit or structure.
 * @returns {number} - The remaining build time in game frames.
 */
function getBuildTimeLeft(unit, buildTime, progress) {
  // Handle undefined buildTime by returning a large number, indicating the build is not close to finishing
  if (buildTime === undefined) return Number.MAX_SAFE_INTEGER;

  const { buffIds } = unit;
  if (buffIds && buffIds.includes(Buff.CHRONOBOOSTENERGYCOST)) {
    buildTime = buildTime * 2 / 3;  // Chrono Boost accelerates construction/training time
  }

  return Math.round(buildTime * (1 - progress));
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
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getConstructionTimeLeft(world, unit, inSeconds = true) {
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos, targetUnitTag } = constructingOrder; if (targetWorldSpacePos === undefined && targetUnitTag === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  let targetPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined; if (targetPosition === undefined) return 0;
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && getDistance(unit.pos, targetPosition) < 1);
  const { buildTime } = data.getUnitTypeData(unitTypeBeingConstructed); if (buildTime === undefined) return 0;
  if (unitAtTargetPosition !== undefined) {
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
  } else {
    buildTimeLeft = buildTime;
  }
  if (inSeconds) {
    return getTimeInSeconds(buildTimeLeft);
  }
  return buildTimeLeft;
}

/**
 * @param {UnitResource} units
 * @param {Unit} unit
 * @returns {Point2D|undefined}
 */
function getOrderTargetPosition(units, unit) {
  if (unit.orders && unit.orders.length > 0) {
    const order = unit.orders[0];
    if (order.targetWorldSpacePos) {
      return order.targetWorldSpacePos;
    } else if (order.targetUnitTag) {
      const targetUnit = units.getByTag(order.targetUnitTag);
      if (targetUnit) {
        return targetUnit.pos;
      }
    }
  }
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
 * Retrieves units that are currently training a specific unit type.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The unit type to check for.
 * @returns {Unit[]} - Array of units training the specified unit type.
 */
function getUnitsTrainingTargetUnitType(world, unitType) {
  const { data, resources } = world;
  const unitsResource = resources.get().units;
  let { abilityId } = data.getUnitTypeData(unitType);
  if (abilityId === undefined) return [];

  // Retrieve the array of units from the UnitResource object
  const unitArray = unitsResource.getAll(); // Assuming 'getAll()' is the method to get unit array from UnitResource

  return GameState.getUnitsWithCurrentOrders(unitArray, [abilityId]);
}

/**
 * Get the worker reserved for a specific position.
 * @param {Point2D} position - The position where the structure will be built.
 * @returns {string | undefined} - The tag of the reserved worker or undefined.
 */
function getWorkerReservedForPosition(position) {
  for (const [workerTag, reservedPosition] of reservedWorkersByPosition.entries()) {
    if (areApproximatelyEqual(reservedPosition, position)) {
      return workerTag;
    }
  }
  return undefined;
}

/**
 * Sets rally points for workers and stops a unit from moving to a position.
 * @param {World} world
 * @param {Unit} unit
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const handleRallyBase = (world, unit, position) => {
  let actions = [];
  actions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering, false));
  actions.push(...stopUnitFromMovingToPosition(unit, position));
  return actions;
};

/**
 * @param {Unit} unit
 * @param {boolean} pending
 * @returns {boolean}
 **/
function isConstructing(unit, pending = false) {
  /** @type {SC2APIProtocol.UnitOrder[]} */
  let pendingOrders = [];
  if (pending) {
    pendingOrders = getPendingOrders(unit);
  }
  return unit.isConstructing() || pendingOrders.some(order => order.abilityId && groupTypes.constructionAbilities.includes(order.abilityId));
}

/**
 * @param {DataStorage} data
 * @param {Unit} unit
 * @returns {boolean}
 */
function isIdleOrAlmostIdle(data, unit) {
  // if the unit is idle, no need to check anything else
  if (unit.orders && unit.orders.length === 0 && unit.buildProgress && unit.buildProgress === 1) {
    return true;
  }

  // now check if it is almost idle
  const { abilityId = null, progress = null } = (unit.orders && unit.orders.length > 0) ? unit.orders[0] : {};
  let unitTypeTraining;
  if (abilityId !== null) {
    unitTypeTraining = unitTypeTrainingAbilities.get(abilityId);
  }
  const unitTypeData = unitTypeTraining && data.getUnitTypeData(unitTypeTraining);
  const { buildTime } = unitTypeData || {};
  let buildTimeLeft;
  if (buildTime !== undefined && progress !== null) {
    buildTimeLeft = getBuildTimeLeft(unit, buildTime, progress);
  }
  const isAlmostIdle = buildTimeLeft !== undefined && buildTimeLeft <= 8 && getPendingOrders(unit).length === 0;
  return isAlmostIdle;
}

/**
 * @param {UnitResource} units
 * @param {Unit} worker
 * @returns {boolean}
 **/
function isMining(units, worker) {
  const { pos, unitType } = worker; if (pos === undefined || unitType === undefined) { return false; }
  const orderTargetPosition = getOrderTargetPosition(units, worker); if (orderTargetPosition === undefined) { return false; }
  const distanceToResource = getDistance(pos, orderTargetPosition);
  let minimumDistanceToResource = 0;
  if (worker.isGathering('vespene')) {
    minimumDistanceToResource = 2.28;
  } else if (worker.isGathering('minerals')) {
    minimumDistanceToResource = unitType === UnitType.MULE ? 1.92 : 1.62;
  }
  return distanceToResource < minimumDistanceToResource;
}

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
 * Checks if a worker is currently reserved for building a structure.
 * 
 * @param {Unit} worker - The worker unit to check.
 * @returns {boolean} True if the worker is reserved for building, false otherwise.
 */
function isWorkerReservedForBuilding(worker) {
  return worker.tag ? reservedWorkers.has(worker.tag) : false;
}

/**
 * Rallies a worker to a specified target position.
 * @param {World} world 
 * @param {Point2D} position
 * @param {(units: Unit[]) => Unit[]} getUnitsFromClustering - Injected dependency from unitManagement.js
 * @param {boolean} mineralTarget
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
const rallyWorkerToTarget = (world, position, getUnitsFromClustering, mineralTarget = true) => {
  const { rallyWorkersAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { DRONE, EGG } = UnitType;

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  const workerSourceByPath = getWorkerSourceByPath(world, position, getUnitsFromClustering);
  if (!workerSourceByPath) return collectedActions;

  const { orders, pos } = workerSourceByPath;
  if (pos === undefined) return collectedActions;

  if (getPendingOrders(workerSourceByPath).some(order => order.abilityId && order.abilityId === Ability.SMART)) return collectedActions;

  let rallyAbility = null;
  if (workerSourceByPath.unitType === EGG) {
    rallyAbility = orders?.some(order => order.abilityId === data.getUnitTypeData(DRONE).abilityId) ? Ability.RALLY_BUILDING : null;
  } else {
    rallyAbility = rallyWorkersAbilities.find(ability => workerSourceByPath.abilityAvailable(ability));
  }

  if (!rallyAbility) return collectedActions;

  const unitCommand = createUnitCommand(Ability.SMART, [workerSourceByPath]);
  if (mineralTarget) {
    const mineralFields = units.getMineralFields().filter(mineralField => mineralField.pos && getDistance(pos, mineralField.pos) < 14);
    const neediestMineralField = getNeediestMineralField(units, mineralFields);
    if (neediestMineralField === undefined) return collectedActions;
    unitCommand.targetUnitTag = neediestMineralField.tag;
  } else {
    unitCommand.targetWorldSpacePos = position;
  }

  collectedActions.push(unitCommand);
  setPendingOrders(workerSourceByPath, unitCommand);

  return collectedActions;
};

/**
 * Reserve a worker for building a structure at a specific position.
 * @param {Unit} worker - The worker unit to reserve.
 * @param {Point2D} position - The position where the structure will be built.
 */
function reserveWorkerForBuilding(worker, position) {
  if (worker.tag && position) {
    reservedWorkers.add(worker.tag);
    reservedWorkersByPosition.set(worker.tag, position);
  }
}

/**
 * Release a worker from building a structure.
 * @param {Unit} worker - The worker unit to release.
 */
function releaseWorkerFromBuilding(worker) {
  if (worker.tag) {
    reservedWorkers.delete(worker.tag);
    reservedWorkersByPosition.delete(worker.tag);
  }
}

/**
 * @param {Unit} builder
 */
function setBuilderLabel(builder) {
  builder.labels.set('builder', true);
  if (builder.labels.has('mineralField')) {
    const mineralField = builder.labels.get('mineralField');
    if (mineralField) {
      mineralField.labels.set('workerCount', mineralField.labels.get('workerCount') - 1);
      builder.labels.delete('mineralField');
    }
  }
}

/**
 * Determines if there are fewer workers than needed for optimal resource harvesting.
 * @param {World} world - The current game world context.
 * @returns {boolean} - True if more workers are needed, false otherwise.
 */
function shortOnWorkers(world) {
  const { gasMineTypes, townhallTypes } = groupTypes;
  const { agent, resources } = world;
  const { map, units } = resources.get();
  let idealHarvesters = 0
  let assignedHarvesters = 0
  const mineralCollectors = [...units.getBases(), ...getById(resources, gasMineTypes)];
  mineralCollectors.forEach(mineralCollector => {
    const { buildProgress, assignedHarvesters: assigned, idealHarvesters: ideal, unitType } = mineralCollector;
    if (buildProgress === undefined || assigned === undefined || ideal === undefined || unitType === undefined) return;
    if (buildProgress === 1) {
      assignedHarvesters += assigned;
      idealHarvesters += ideal;
    } else {
      if (townhallTypes.includes(unitType)) {
        const { pos: townhallPos } = mineralCollector; if (townhallPos === undefined) return false;
        if (map.getExpansions().some(expansion => getDistance(expansion.townhallPosition, townhallPos) < 1)) {
          let mineralFields = [];
          if (!mineralCollector.labels.has('mineralFields')) {
            mineralFields = units.getMineralFields().filter(mineralField => {
              const { pos } = mineralField; if (pos === undefined) return false;
              if (getDistance(pos, townhallPos) < 16) {
                const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, townhallPos)
                const { pathablePosition, pathableTargetPosition } = closestPathablePositionBetweenPositions;
                const distanceByPath = getDistanceByPath(resources, pathablePosition, pathableTargetPosition);
                return distanceByPath <= 16;
              } else {
                return false;
              }
            });
            mineralCollector.labels.set('mineralFields', mineralFields);
          }
          mineralFields = mineralCollector.labels.get('mineralFields');
          idealHarvesters += mineralFields.length * 2 * buildProgress;
        }
      } else {
        idealHarvesters += 3 * buildProgress;
      }
    }
  });


  if (agent.race === undefined) {
    console.error("Agent race is undefined.");
    return false; // Or handle this situation as appropriate
  }

  // count workers that are training
  const unitsTrainingTargetUnitType = getUnitsTrainingTargetUnitType(world, WorkerRace[agent.race]);
  const shortOnWorkers = idealHarvesters > (assignedHarvesters + unitsTrainingTargetUnitType.length);

  return shortOnWorkers;
}

/**
 * Stops a unit from moving to a specified position.
 * @param {Unit} unit 
 * @param {Point2D} position 
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function stopUnitFromMovingToPosition(unit, position) {
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const { orders } = unit;
  if (orders === undefined) return collectedActions;
  if (orders.length > 0) {
    const { targetWorldSpacePos } = orders[0];
    if (targetWorldSpacePos === undefined) return collectedActions;
    const distanceToTarget = getDistance(targetWorldSpacePos, position);
    if (distanceToTarget < 1) {
      collectedActions.push(createUnitCommand(Ability.STOP, [unit]));
    }
  }
  return collectedActions;
}

// Export the shared functions
module.exports = {
  ability,
  calculateMovingOrConstructingNonDronesTimeToPosition,
  handleRallyBase,
  filterBuilderCandidates,
  filterMovingOrConstructingNonDrones,
  gatherBuilderCandidates,
  getBuilderCandidateClusters,
  getBuildTimeLeft,
  getClosestExpansion,
  getClosestPathWithGasGeysers,
  getOrderTargetPosition,
  getUnitsFromClustering,
  getWorkerReservedForPosition,
  isIdleOrAlmostIdle,
  isMining,
  isMoving,
  isWorkerReservedForBuilding,
  rallyWorkerToTarget,
  releaseWorkerFromBuilding,
  reserveWorkerForBuilding,
  setBuilderLabel,
  shortOnWorkers,
};
