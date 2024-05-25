// workerManagementUtils.js
"use strict";

// External library imports
const { Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { GasMineRace, WorkerRace } = require('@node-sc2/core/constants/race-map');

// Internal module imports
const { getMovementSpeed } = require('./coreUtils');
const { setBuilderLabel, getClosestPathWithGasGeysers, getBuildTimeLeft } = require('./economy/workerService');
const { calculateBaseTimeToPosition } = require('./pathfinding');
const { getDistanceByPath, getClosestPositionByPath } = require('./pathfindingCore');
const { findPathablePositions } = require('./pathfindingUtils');
const { isPendingContructing } = require('./workerCommonUtils');
const { createUnitCommand, getPathablePositionsForStructure } = require('../core/utils/common');
const { stopOverlappingBuilders } = require('../features/construction/buildingWorkerInteractions');
const { getTimeToTargetTech } = require('../features/misc/gameData');
// eslint-disable-next-line no-unused-vars
const { GameState } = require('../gameState');
const { unitTypeTrainingAbilities } = require('../units/management/unitConfig');
const { setPendingOrders } = require('../units/management/unitOrders');

/**
 * Adjusts the time to position based on whether the unit should rally to the base or not.
 * Includes calculation of the base distance to the position as required by calculateBaseTimeToPosition.
 * @param {boolean} rallyBase
 * @param {number} buildTimeLeft
 * @param {number} movementSpeedPerSecond
 * @param {number} originalTimeToPosition
 * @param {number} baseDistanceToPosition - The distance from the base to the target position.
 * @returns {number}
 */
function adjustTimeToPosition(rallyBase, buildTimeLeft, movementSpeedPerSecond, originalTimeToPosition, baseDistanceToPosition) {
  if (rallyBase) {
    return calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond);
  }
  return originalTimeToPosition;
}

/**
 * Calculates the movement speed per second from the unit's data.
 * @param {Unit} unit
 * @returns {number} Movement speed per second
 */
function calculateMovementSpeed(unit) {
  const movementSpeed = unit.data().movementSpeed || 0;
  return movementSpeed * 1.4; // Apply any necessary conversion factor
}

/**
 * Calculates the maximum of time to target cost or time to target technology from unit data.
 * @param {World} world
 * @param {Unit} unit
 * @param {number} timeToTargetCost Pre-calculated time to target cost.
 * @returns {number}
 */
function calculateTimeToTargetCostOrTech(world, unit, timeToTargetCost) {
  if (!unit.unitType) {
    console.error("Unit type is undefined, cannot calculate time to target tech.");
    return timeToTargetCost; // Return the already known cost as the maximum.
  }
  const timeToTargetTech = getTimeToTargetTech(world, unit.unitType);
  return Math.max(timeToTargetCost, timeToTargetTech);
}

/**
 * Checks if a worker is currently training and calculates if rallying to a base is needed based on timing.
 * Adjusts the calculation to ensure positions are pathable before computing distance.
 * @param {World} world
 * @param {Unit} base
 * @param {Point2D} targetPosition - The target position to move towards.
 * @param {number} timeToPosition - Current estimated time to the target position.
 * @param {number} movementSpeedPerSecond - Speed of the worker unit.
 * @returns {{rallyBase: boolean, buildTimeLeft: number}}
 */
function checkWorkerTraining(world, base, targetPosition, timeToPosition, movementSpeedPerSecond) {
  const buildTimeLeft = getCurrentWorkerBuildTimeLeft(base, world);
  const { pathableBasePosition, pathableTargetPosition } = findPathablePositions(world, base, targetPosition);

  if (!pathableBasePosition || !pathableTargetPosition) {
    console.error("Pathable positions are undefined.");
    return { rallyBase: false, buildTimeLeft };
  }

  const baseDistanceToPosition = getDistanceByPath(world.resources, pathableBasePosition, pathableTargetPosition);
  const baseTimeToPosition = calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond);

  return {
    rallyBase: timeToPosition > baseTimeToPosition,
    buildTimeLeft
  };
}

/**
 * Commands the provided builder to construct a structure.
 * @param {World} world 
 * @param {Unit} builder The builder to command.
 * @param {UnitTypeId} unitType 
 * @param {Point2D} position
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function commandBuilderToConstruct(world, builder, unitType, position) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const { abilityId } = data.getUnitTypeData(unitType);

  const collectedActions = [];

  if (!builder.isConstructing() && !isPendingContructing(builder) && abilityId !== undefined) {
    setBuilderLabel(builder);
    const unitCommand = createUnitCommand(abilityId, [builder]);

    if (agent.race !== undefined && GasMineRace[agent.race] === unitType) {
      const closestGasGeyser = units.getClosest(position, units.getGasGeysers())[0];
      if (closestGasGeyser) {
        unitCommand.targetUnitTag = closestGasGeyser.tag;
      }
    } else {
      unitCommand.targetWorldSpacePos = position;
    }

    collectedActions.push(unitCommand);
    setPendingOrders(builder, unitCommand);
    collectedActions.push(...stopOverlappingBuilders(units, builder, position));
  }

  return collectedActions;
}

/**
 * Gathers candidate workers based on their time to reach a specified position.
 * 
 * @param {ResourceManager} resources - The resources available in the game world.
 * @param {Point2D} position - The target position to reach.
 * @param {{unit: Unit, timeToPosition: number}[]} movingOrConstructingNonDronesTimeToPosition - Array of non-drone units that are moving or constructing and their respective time to reach the position.
 * @param {Unit | undefined} closestBuilder - The closest available builder unit.
 * @param {GameState} gameState - The current game state.
 * @returns {Array<{unit: Unit, timeToPosition: number}>} - Array of candidate workers with their time to reach the position.
 */
function gatherCandidateWorkersTimeToPosition(resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilder, gameState) {
  const { map } = resources.get();
  let candidateWorkersTimeToPosition = [];

  const [movingOrConstructingNonDrone] = movingOrConstructingNonDronesTimeToPosition.sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.timeToPosition - b.timeToPosition;
  });

  if (movingOrConstructingNonDrone !== undefined) {
    candidateWorkersTimeToPosition.push(movingOrConstructingNonDrone);
  }

  if (closestBuilder !== undefined) {
    const { pos } = closestBuilder;
    if (pos === undefined) return candidateWorkersTimeToPosition;

    const movementSpeed = getMovementSpeed(map, closestBuilder, gameState);
    if (movementSpeed === undefined) return candidateWorkersTimeToPosition;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const closestPathablePositionsBetweenPositions = getClosestPathWithGasGeysers(resources, pos, position);
    const closestBuilderWithDistance = {
      unit: closestBuilder,
      timeToPosition: closestPathablePositionsBetweenPositions.distance / movementSpeedPerSecond
    };

    candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
  }

  return candidateWorkersTimeToPosition;
}

/**
 * Determines the current build time left for a worker that is being trained at a base.
 * @param {Unit} base - The base unit to check for ongoing worker training.
 * @param {World} world - The game world context.
 * @returns {number} - The remaining build time for the worker, or 0 if no worker is being trained.
 */
function getCurrentWorkerBuildTimeLeft(base, world) {
  const { data, agent } = world;
  if (base.orders?.some(order => isWorkerTrainingOrder(order))) {
    const buildTime = data.getUnitTypeData(WorkerRace[agent.race || Race.TERRAN]).buildTime || 0;
    const progress = base.orders[0]?.progress || 0;
    return getBuildTimeLeft(base, buildTime, progress);
  }
  return 0;
}

/**
 * Checks if the given order is for training a worker.
 * @param {SC2APIProtocol.UnitOrder} order
 * @returns {boolean} - True if the order is for training a worker, false otherwise.
 */
function isWorkerTrainingOrder(order) {
  const abilityId = order.abilityId;
  if (abilityId === undefined) {
    return false;
  }
  const unitTypeForAbility = unitTypeTrainingAbilities.get(abilityId);
  return unitTypeForAbility !== undefined && groupTypes.workerTypes.includes(unitTypeForAbility);
}

/**
 * Prepares the building context for a given unit and target position.
 * @param {World} world
 * @param {Unit} base
 * @param {Point2D} position
 * @param {number} timeToPosition
 * @param {Unit} unit
 * @param {number} timeToTargetCost
 * @returns {{ rallyBase: boolean, buildTimeLeft: number, timeToPosition: number, timeToTargetCostOrTech: number }}
 */
function prepareBuildContext(world, base, position, timeToPosition, unit, timeToTargetCost) {
  const { resources } = world;
  const { map } = resources.get();

  const movementSpeedPerSecond = calculateMovementSpeed(unit)

  const { pos } = unit;
  if (pos === undefined) return { rallyBase: false, buildTimeLeft: 0, timeToPosition, timeToTargetCostOrTech: 0 };

  const closestPathablePositionBetweenPositions = getClosestPathWithGasGeysers(resources, pos, position);
  const { pathableTargetPosition } = closestPathablePositionBetweenPositions;
  const pathablePositions = getPathablePositionsForStructure(map, base);
  const [pathableStructurePosition] = getClosestPositionByPath(resources, pathableTargetPosition, pathablePositions);
  const baseDistanceToPosition = getDistanceByPath(resources, pathableStructurePosition, pathableTargetPosition);

  const { rallyBase, buildTimeLeft } = checkWorkerTraining(world, base, position, timeToPosition, movementSpeedPerSecond);

  const timeToTargetCostOrTech = calculateTimeToTargetCostOrTech(world, unit, timeToTargetCost);

  return {
    rallyBase,
    buildTimeLeft,
    timeToPosition: adjustTimeToPosition(rallyBase, buildTimeLeft, movementSpeedPerSecond, timeToPosition, baseDistanceToPosition),
    timeToTargetCostOrTech
  };
}

module.exports = {
  commandBuilderToConstruct,
  gatherCandidateWorkersTimeToPosition,
  prepareBuildContext,
};
