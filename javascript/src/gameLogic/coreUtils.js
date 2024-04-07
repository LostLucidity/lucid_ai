// coreUtils.js

const { UnitType } = require("@node-sc2/core/constants");
const Buff = require("@node-sc2/core/constants/buff");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");

// eslint-disable-next-line no-unused-vars
const GameState = require("../core/gameState");
const { SPEED_MODIFIERS } = require("../utils/common/contants");
const { getClosestUnitByPath, getTimeInSeconds } = require("../utils/pathfinding/pathfinding");
const { getDistanceByPath } = require("../utils/pathfinding/pathfindingCommon");
const { getDistance } = require("../utils/spatial/spatialCoreUtils");
const { getMovementSpeedByType, ZERG_UNITS_ON_CREEP_BONUS, unitTypeTrainingAbilities } = require("../utils/training/unitConfig");


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
 * Calculate the closest constructing worker and the time to reach a specific position
 * @param {World} world - The resources object to access game state
 * @param {Unit[]} constructingWorkers - The array of workers currently in constructing state
 * @param {Point2D} position - The position to calculate the distance to
 * @returns {{unit: Unit, timeToPosition: number} | undefined} - Closest constructing worker and time to reach the position or undefined
 */
function calculateClosestConstructingWorker(world, constructingWorkers, position) {
  const { data, resources } = world;
  const { units } = resources.get();

  return constructingWorkers.reduce((/** @type {{unit: Unit, timeToPosition: number} | undefined} */closestWorker, worker) => {
    const { orders, pos } = worker; if (orders === undefined || pos === undefined) return closestWorker;
    // get unit type of building in construction
    const constructingOrder = orders.find(order => order.abilityId && groupTypes.constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return closestWorker;
    const { abilityId } = constructingOrder; if (abilityId === undefined) return closestWorker;
    const unitType = unitTypeTrainingAbilities.get(abilityId); if (unitType === undefined) return closestWorker;
    const { buildTime } = data.getUnitTypeData(unitType); if (buildTime === undefined) return closestWorker;

    // get closest unit type to worker position if within unit type radius
    const closestUnitType = units.getClosest(pos, units.getById(unitType)).filter(unit => unit.pos && getDistance(unit.pos, pos) < 3)[0];

    if (closestUnitType) {
      const { buildProgress } = closestUnitType; if (buildProgress === undefined) return closestWorker;
      const buildTimeLeft = getTimeInSeconds(buildTime - (buildTime * buildProgress));
      const distanceToPositionByPath = getDistanceByPath(resources, pos, position);
      const { movementSpeed } = worker.data(); if (movementSpeed === undefined) return closestWorker;
      const movementSpeedPerSecond = movementSpeed * 1.4;
      const timeToPosition = buildTimeLeft + (distanceToPositionByPath / movementSpeedPerSecond);

      // If this is the first worker or if it's closer than the current closest worker, update closestWorker
      if (!closestWorker || timeToPosition < closestWorker.timeToPosition) {
        return { unit: worker, timeToPosition };
      }
    }

    return closestWorker;
  }, undefined);
}

/**
 * Finds the closest base to a mineral field.
 * @param {Unit} mineralField - The mineral field unit.
 * @param {Unit[]} bases - An array of base units.
 * @returns {Unit | undefined} The closest base to the mineral field, or undefined if none are found.
 */
function findClosestBase(mineralField, bases) {
  // Ensure that the position of the mineral field is defined
  if (!mineralField.pos) {
    return undefined;
  }

  return findClosestUnit(mineralField.pos, bases);
}

/**
 * Finds the closest mineral field to a worker.
 * @param {Unit} worker - The worker unit.
 * @param {Unit[]} mineralFields - An array of mineral field units.
 * @param {Unit[]} bases - An array of base units.
 * @returns {Unit | undefined} The closest mineral field to the worker, or undefined if none are found.
 */
function findClosestMineralField(worker, mineralFields, bases) {
  if (!worker.pos) return undefined;

  const closestMineralField = findClosestUnit(worker.pos, mineralFields);
  if (closestMineralField && closestMineralField.pos) {
    const closestBase = findClosestBase(closestMineralField, bases);
    if (closestBase && closestBase.pos && getDistance(closestMineralField.pos, closestBase.pos) <= 20) {
      return closestMineralField;
    }
  }

  return undefined;
}

/**
 * Generic function to find the closest unit from a list to a given position.
 * @param {Point2D} position - The position to find the closest unit to.
 * @param {Unit[]} units - The list of units to search.
 * @returns {Unit | undefined} The closest unit, or undefined if none are found.
 */
function findClosestUnit(position, units) {
  let closestUnit = undefined;
  let minDistance = Number.MAX_VALUE;

  units.forEach(unit => {
    if (unit.pos) {
      const distance = getDistance(position, unit.pos);
      if (distance < minDistance) {
        minDistance = distance;
        closestUnit = unit;
      }
    }
  });

  return closestUnit;
}

/**
 * Constants defined outside the function to avoid reinitialization on every call.
 */
const NO_CREEP_BONUS_TYPES = new Set([UnitType.DRONE, UnitType.BROODLING, UnitType.CHANGELING /* and any burrowed unit type */]);
const DEFAULT_CREEP_SPEED_BONUS = 1.3;

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

  // Start with a base multiplier and conditionally modify it
  let multiplier = adjustForRealSeconds ? 1.4 : 1;
  if (unit.buffIds?.includes(Buff.STIMPACK)) {
    multiplier *= 1.5;
  }
  if (map.hasCreep(pos) && !NO_CREEP_BONUS_TYPES.has(unitType)) {
    multiplier *= ZERG_UNITS_ON_CREEP_BONUS.get(unitType) || DEFAULT_CREEP_SPEED_BONUS;
  }

  const speedModifierFunc = SPEED_MODIFIERS.get(unitType);
  if (speedModifierFunc) {
    movementSpeed += speedModifierFunc(unit, gameState);
  }

  return movementSpeed * multiplier;
}

/**
 * Get the closest worker source to a given position.
 * @param {World} world
 * @param {Point2D} position
 * @param {(units: Unit[]) => Unit[]} getUnitsFromClustering - Function to cluster units, injected dependency.
 * @returns {Unit}
 */
const getWorkerSourceByPath = (world, position, getUnitsFromClustering) => {
  const { agent, resources } = world;
  const { units } = resources.get();
  const { EGG } = UnitType;

  let unitList;
  if (agent.race === Race.ZERG) {
    unitList = getUnitsFromClustering(units.getById(EGG));
  } else {
    unitList = getUnitsFromClustering(units.getBases().filter(base => base.buildProgress && base.buildProgress >= 1));
  }

  const [closestUnitByPath] = getClosestUnitByPath(resources, position, unitList);
  return closestUnitByPath;
}

// Other foundational utility functions can be added here

module.exports = {
  calculateClosestConstructingWorker,
  calculateDistance,
  findClosestBase,
  findClosestMineralField,
  getMovementSpeed,
  getWorkerSourceByPath,
};
