"use strict";

// External library imports
const { Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { GasMineRace, WorkerRace } = require('@node-sc2/core/constants/race-map');

// Internal module imports
const { getMovementSpeed } = require('./coreUtils');
const { calculateBaseTimeToPosition } = require('./pathfinding/pathfinding');
const { getDistanceByPath, getClosestPositionByPath } = require('./pathfinding/pathfindingCore');
const { isPendingContructing } = require('./workerCommonUtils');
const { setBuilderLabel, getClosestPathWithGasGeysers, getBuildTimeLeft } = require('../../gameLogic/economy/workerService');
// eslint-disable-next-line no-unused-vars
const { GameState } = require('../../gameState');
const { unitTypeTrainingAbilities } = require('../../units/management/unitConfig');
const { setPendingOrders } = require('../../units/management/unitOrders');
const { createUnitCommand, getPathablePositionsForStructure } = require('../../utils/common');
const { findPathablePositions } = require('../../utils/pathfindingUtils');
const { stopOverlappingBuilders } = require('../construction/buildingWorkerInteractions');
const { getTimeToTargetTech } = require('../misc/gameData');

/**
 * Adjusts the time to position based on whether the unit should rally to the base or not.
 * @param {boolean} rallyBase
 * @param {number} buildTimeLeft
 * @param {number} movementSpeedPerSecond
 * @param {number} originalTimeToPosition
 * @param {number} baseDistanceToPosition
 * @returns {number}
 */
function adjustTimeToPosition(rallyBase, buildTimeLeft, movementSpeedPerSecond, originalTimeToPosition, baseDistanceToPosition) {
  return rallyBase ? calculateBaseTimeToPosition(baseDistanceToPosition, buildTimeLeft, movementSpeedPerSecond) : originalTimeToPosition;
}

/**
 * Calculates the movement speed per second from the unit's data.
 * @param {Unit} unit
 * @returns {number}
 */
function calculateMovementSpeed(unit) {
  return (unit.data().movementSpeed || 0) * 1.4; // Apply conversion factor if needed
}

/**
 * Calculates the maximum of time to target cost or time to target technology from unit data.
 * @param {World} world
 * @param {number} timeToTargetCost
 * @param {UnitTypeId} unitType
 * @returns {number}
 */
function calculateTimeToTargetCostOrTech(world, timeToTargetCost, unitType) {
  if (!unitType) {
    console.error("Unit type is undefined, returning time to target cost:", timeToTargetCost);
    return timeToTargetCost;
  }

  const timeToTargetTech = getTimeToTargetTech(world, unitType);
  if (isNaN(timeToTargetTech)) {
    console.error("Invalid time to target tech calculated, returning time to target cost:", timeToTargetCost);
    return timeToTargetCost;
  }

  return Math.max(timeToTargetCost, timeToTargetTech);
}

/**
 * Checks if a worker is currently training and calculates if rallying to a base is needed based on timing.
 * @param {World} world
 * @param {Unit} base
 * @param {Point2D} targetPosition
 * @param {number} timeToPosition
 * @param {number} movementSpeedPerSecond
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
 * @param {Unit} builder
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
 * @param {ResourceManager} resources
 * @param {Point2D} position
 * @param {{unit: Unit, timeToPosition: number}[]} movingOrConstructingNonDronesTimeToPosition
 * @param {Unit} closestBuilder
 * @param {GameState} gameState
 * @returns {Array<{unit: Unit, timeToPosition: number}>}
 */
function gatherCandidateWorkersTimeToPosition(resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilder, gameState) {
  const { map } = resources.get();
  let candidateWorkersTimeToPosition = [];

  const [movingOrConstructingNonDrone] = movingOrConstructingNonDronesTimeToPosition.sort((a, b) => a.timeToPosition - b.timeToPosition);

  if (movingOrConstructingNonDrone) candidateWorkersTimeToPosition.push(movingOrConstructingNonDrone);

  if (closestBuilder && closestBuilder.pos) {
    const movementSpeed = getMovementSpeed(map, closestBuilder, gameState);
    if (movementSpeed !== undefined) {
      const movementSpeedPerSecond = movementSpeed * 1.4;
      const closestPathablePositionsBetweenPositions = getClosestPathWithGasGeysers(resources, closestBuilder.pos, position);
      const closestBuilderWithDistance = {
        unit: closestBuilder,
        timeToPosition: closestPathablePositionsBetweenPositions.distance / movementSpeedPerSecond
      };
      candidateWorkersTimeToPosition.push(closestBuilderWithDistance);
    }
  }

  return candidateWorkersTimeToPosition;
}

/**
 * Determines the current build time left for a worker that is being trained at a base.
 * @param {Unit} base
 * @param {World} world
 * @returns {number}
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
 * @returns {boolean}
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
 * @param {UnitTypeId} unitType
 * @returns {{ rallyBase: boolean, buildTimeLeft: number, timeToPosition: number, timeToTargetCostOrTech: number }}
 */
function prepareBuildContext(world, base, position, timeToPosition, unit, timeToTargetCost, unitType) {
  const resources = world.resources;
  const map = resources.get().map;

  const movementSpeedPerSecond = calculateMovementSpeed(unit);
  if (!unit.pos) return { rallyBase: false, buildTimeLeft: 0, timeToPosition, timeToTargetCostOrTech: 0 };

  const closestPathData = getClosestPathWithGasGeysers(resources, unit.pos, position);
  const pathableTargetPosition = closestPathData.pathableTargetPosition;
  const pathablePositions = getPathablePositionsForStructure(map, base);
  const closestPosition = getClosestPositionByPath(resources, pathableTargetPosition, pathablePositions)[0];
  const baseDistanceToPosition = getDistanceByPath(resources, closestPosition, pathableTargetPosition);

  const { rallyBase, buildTimeLeft } = checkWorkerTraining(world, base, position, timeToPosition, movementSpeedPerSecond);

  const adjustedTimeToPosition = adjustTimeToPosition(rallyBase, buildTimeLeft, movementSpeedPerSecond, timeToPosition, baseDistanceToPosition);
  const timeToTargetCostOrTech = calculateTimeToTargetCostOrTech(world, timeToTargetCost, unitType);

  return {
    rallyBase,
    buildTimeLeft,
    timeToPosition: adjustedTimeToPosition,
    timeToTargetCostOrTech
  };
}

module.exports = {
  commandBuilderToConstruct,
  gatherCandidateWorkersTimeToPosition,
  prepareBuildContext,
};
