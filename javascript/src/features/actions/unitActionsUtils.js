// src/core/utils/unitActionsUtils.js
"use strict";

// Import necessary dependencies, constants, and utilities
const { UnitType, Ability } = require('@node-sc2/core/constants');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { avgPoints } = require('@node-sc2/core/utils/geometry/point');
const getRandom = require('@node-sc2/core/utils/get-random');

const { addEarmark } = require('../../core/common/buildUtils');
const { earmarkThresholdReached } = require('../../core/common/EarmarkManager');
const { createUnitCommand } = require('../../core/utils/common');
const { getPathCoordinates, getMapPath } = require('../../gameLogic/spatial/pathfindingCommon');
const { calculatePathablePositions } = require('../../gameLogic/spatial/pathfindingUtils');
const { ability, isIdleOrAlmostIdle, handleRallyBase, getOrderTargetPosition, rallyWorkerToTarget, getUnitsFromClustering } = require('../../gameLogic/utils/economy/workerService');
const { prepareBuildContext } = require('../../gameLogic/workerManagementUtils');
const { GameState } = require('../../gameState');
const { getPendingOrders } = require('../../sharedServices');
const BuildingPlacement = require('../construction/buildingPlacement');
const { handleNonRallyBase } = require('../construction/buildingWorkerInteractions');

/**
 * Builds a structure using a Nydus Network.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The type of the unit to be built.
 * @param {AbilityId} abilityId - The ability ID for the construction action.
 * @return {SC2APIProtocol.ActionRawUnitCommand[]} - A promise that resolves to an array of unit commands.
 */
function buildWithNydusNetwork(world, unitType, abilityId) {
  const { agent, resources, data } = world;
  const { map, units } = resources.get();
  const collectedActions = [];
  const foundPosition = BuildingPlacement.getFoundPosition();
  const nydusNetworks = units.getById(UnitType.NYDUSNETWORK, { alliance: Alliance.SELF });

  if (nydusNetworks.length > 0) {
    // randomly pick a nydus network
    const nydusNetwork = getRandom(nydusNetworks);

    if (agent.canAfford(unitType)) {
      if (foundPosition && map.isPlaceableAt(unitType, foundPosition)) {
        const unitCommand = createUnitCommand(abilityId, [nydusNetwork]);
        unitCommand.targetWorldSpacePos = foundPosition;
        collectedActions.push(unitCommand);
        addEarmark(data, data.getUnitTypeData(unitType));
        BuildingPlacement.updateFoundPosition(null);
      } else {
        BuildingPlacement.updateFoundPosition(null);
      }
    }
  }

  return collectedActions;
}

/**
 * @param {Debugger | undefined} debug
 * @param {MapResource} map
 * @param {Point2D} startPos
 * @param {Point2D} targetPos
 */
function drawDebugPath(debug, map, startPos, targetPos) {
  if (debug) {
    debug.setDrawCells('prmv', getPathCoordinates(getMapPath(map, startPos, targetPos)).map(point => ({ pos: point })), { size: 1, cube: false });
  }
}

/**
 * Handles specific building actions based on the unit's race, position adjustments,
 * and whether the unit should rally or proceed with non-rally tasks.
 * @param {World} world - The game world context.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - The array to collect actions to be executed.
 * @param {{
    rallyBase: boolean;
    buildTimeLeft: number;
    timeToPosition: number;
    timeToTargetCostOrTech: number;
}} buildContext - Context containing flags and timings for building.
 * @param {Unit} unit - The unit object to manipulate.
 * @param {Point2D} position - The position to use for operations.
 * @param {SC2APIProtocol.Race | undefined} race - The race of the unit.
 * @param {Point2D[]} pathCoordinates - Array of positions forming the path.
 * @param {number[]} constructionAbilities - List of construction abilities relevant to the unit.
 * @param {number} unitType - The type of the unit to check against specific conditions.
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand - The unit command to execute.
 * @param {(world: World, unit: Unit, position: Point2D) => SC2APIProtocol.ActionRawUnitCommand[]} handleRallyBase - Function to handle rally base logic.
 * @param {(world: World, unit: Unit, position: Point2D, unitCommand: SC2APIProtocol.ActionRawUnitCommand, unitType: UnitTypeId, getOrderTargetPosition: (units: UnitResource, unit: Unit) => Point2D | undefined) => SC2APIProtocol.ActionRawUnitCommand[]} handleNonRallyBase - Function to handle non-rally base logic.
 * @param {(units: UnitResource, unit: Unit) => Point2D | undefined} getOrderTargetPosition - Function to get the target position for orders.
 */
function handleBuildingActions(world, collectedActions, buildContext, unit, position, race, pathCoordinates, constructionAbilities, unitType, unitCommand, handleRallyBase, handleNonRallyBase, getOrderTargetPosition) {
  if (race === Race.PROTOSS && !groupTypes.gasMineTypes.includes(unitType) && pathCoordinates.length >= 2) {
    const secondToLastPosition = pathCoordinates[pathCoordinates.length - 2];
    position = avgPoints([secondToLastPosition, position, position]);
  }
  if (buildContext.rallyBase) {
    collectedActions.push(...handleRallyBase(world, unit, position));
  } else {
    collectedActions.push(...handleNonRallyBase(world, unit, position, unitCommand, unitType, getOrderTargetPosition));
  }
}

/**
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function morphStructureAction(world, unitType) {
  const { CYCLONE, LAIR } = UnitType;
  const { agent, data } = world;

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  // use unitType for LAIR with CYCLONE when can afford as LAIR data is inflated by the cost of a HATCHERY
  if (agent.canAfford(unitType === LAIR ? CYCLONE : unitType)) {
    const { abilityId } = data.getUnitTypeData(unitType); if (abilityId === undefined) return collectedActions;
    const actions = ability(world, abilityId, isIdleOrAlmostIdle);
    if (actions.length > 0) {
      collectedActions.push(...actions);
    }
  }
  addEarmark(data, data.getUnitTypeData(unitType));
  return collectedActions;
}

/**
 * Moves a builder to a position in preparation for building.
 * @param {World} world 
 * @param {Point2D} position 
 * @param {UnitTypeId} unitType
 * @param {(world: World, position: Point2D) => {unit: Unit, timeToPosition: number} | undefined} getBuilderFunc
 * @param {(position: Point2D, unitType: UnitTypeId) => Point2D} getMiddleOfStructureFn
 * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCostFn
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function premoveBuilderToPosition(world, position, unitType, getBuilderFunc, getMiddleOfStructureFn, getTimeToTargetCostFn) {
  const { constructionAbilities } = groupTypes;
  const { agent, data, resources } = world;
  const { debug, map } = resources.get();

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  position = getMiddleOfStructureFn(position, unitType);

  // Calculate time to target cost before earmarking
  const timeToTargetCost = getTimeToTargetCostFn(world, unitType);
  if (earmarkThresholdReached(data)) {
    return collectedActions;
  }

  // Earmark resources now that we've checked thresholds
  addEarmark(data, data.getUnitTypeData(unitType));
  const adjustedPosition = getMiddleOfStructureFn(position, unitType);
  const builderInfo = getBuilderFunc(world, adjustedPosition);

  if (!builderInfo || !builderInfo.unit.orders || !builderInfo.unit.pos) {
    return collectedActions;
  }

  const { unit, timeToPosition } = builderInfo;
  if (!unit.orders || !unit.pos) {
    return collectedActions;
  }

  const pathablePositionsInfo = calculatePathablePositions(resources, unit.pos, position);
  if (!pathablePositionsInfo.closestBaseByPath) {
    return collectedActions;
  }

  const { pathCoordinates, pathableTargetPosition } = pathablePositionsInfo;
  drawDebugPath(debug, map, unit.pos, pathableTargetPosition);

  const buildContext = prepareBuildContext(world, pathablePositionsInfo.closestBaseByPath, position, timeToPosition, unit, timeToTargetCost);
  const gameState = GameState.getInstance();
  if (gameState.shouldPremoveNow(world, buildContext.timeToTargetCostOrTech, buildContext.timeToPosition)) {
    const pendingConstructionOrder = getPendingOrders(unit).some(order => order.abilityId && constructionAbilities.includes(order.abilityId));
    const unitCommand = builderInfo ? createUnitCommand(Ability.MOVE, [unit], pendingConstructionOrder) : {};
    handleBuildingActions(
      world,
      collectedActions,
      buildContext,
      unit,
      position,
      agent.race,
      pathCoordinates,
      constructionAbilities,
      unitType,
      unitCommand,
      handleRallyBase,
      handleNonRallyBase,
      getOrderTargetPosition
    );
  } else {
    collectedActions.push(...rallyWorkerToTarget(world, position, getUnitsFromClustering));
  }

  return collectedActions;
}

module.exports = {
  buildWithNydusNetwork,
  morphStructureAction,
  premoveBuilderToPosition,
};
