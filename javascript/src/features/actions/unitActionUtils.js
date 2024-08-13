"use strict";

const { UnitType, Ability } = require('@node-sc2/core/constants');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { avgPoints } = require('@node-sc2/core/utils/geometry/point');
const getRandom = require('@node-sc2/core/utils/get-random');

const { EarmarkManager } = require('../../core');
const {
  ability,
  isIdleOrAlmostIdle,
  handleRallyBase,
  getOrderTargetPosition,
  rallyWorkerToTarget,
  getUnitsFromClustering,
} = require('../../gameLogic/economy/workerService');
const { getPendingOrders } = require('../../sharedServices');
const { GameState } = require('../../state');
const { createUnitCommand } = require('../../utils/common');
const { calculatePathablePositions } = require('../../utils/pathfindingUtils');
const BuildingPlacement = require('../construction/buildingPlacement');
const { handleNonRallyBase } = require('../construction/buildingWorkerInteractions');
const { getPathCoordinates, getMapPath } = require('../shared/pathfinding/pathfindingCommonUtils');
const { prepareBuildContext } = require('../shared/workerManagementUtils');

/**
 * @typedef {Object} BuildContext
 * @property {boolean} rallyBase
 * @property {number} buildTimeLeft
 * @property {number} timeToPosition
 * @property {number} timeToTargetCostOrTech
 */

/**
 * Builds a structure using a Nydus Network.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The type of the unit to be built.
 * @param {AbilityId} abilityId - The ability ID for the construction action.
 * @return {SC2APIProtocol.ActionRawUnitCommand[]} - An array of unit commands.
 */
function buildWithNydusNetwork(world, unitType, abilityId) {
  const { agent, resources, data } = world;
  const { map, units } = resources.get();
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const foundPosition = BuildingPlacement.getFoundPosition();
  const nydusNetworks = units.getById(UnitType.NYDUSNETWORK, { alliance: Alliance.SELF });

  if (nydusNetworks.length > 0 && agent.canAfford(unitType)) {
    const nydusNetwork = getRandom(nydusNetworks);
    if (foundPosition && map.isPlaceableAt(unitType, foundPosition)) {
      const unitCommand = createUnitCommand(abilityId, [nydusNetwork]);
      unitCommand.targetWorldSpacePos = foundPosition;
      collectedActions.push(unitCommand);
      EarmarkManager.getInstance().addEarmark(data, data.getUnitTypeData(unitType));
      BuildingPlacement.updateFoundPosition(null);
    } else {
      BuildingPlacement.updateFoundPosition(null);
    }
  }

  return collectedActions;
}

/**
 * Draws a debug path.
 * @param {Debugger | undefined} debug
 * @param {MapResource} map
 * @param {Point2D} startPos
 * @param {Point2D} targetPos
 */
function drawDebugPath(debug, map, startPos, targetPos) {
  if (debug) {
    debug.setDrawCells(
      'prmv',
      getPathCoordinates(getMapPath(map, startPos, targetPos)).map(point => ({ pos: point })),
      { size: 1, cube: false }
    );
  }
}

/**
 * Handles specific building actions.
 * @param {World} world - The game world context.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - The array to collect actions.
 * @param {BuildContext} buildContext - Context containing flags and timings for building.
 * @param {Unit} unit - The unit object to manipulate.
 * @param {Point2D} position - The position to use for operations.
 * @param {SC2APIProtocol.Race | undefined} race - The race of the unit.
 * @param {Point2D[]} pathCoordinates - Array of positions forming the path.
 * @param {number} unitType - The type of the unit to check against specific conditions.
 * @param {SC2APIProtocol.ActionRawUnitCommand} unitCommand - The unit command to execute.
 * @param {Function} handleRallyBase - Function to handle rally base logic.
 * @param {Function} handleNonRallyBase - Function to handle non-rally base logic.
 * @param {Function} getOrderTargetPosition - Function to get the target position for orders.
 */
function handleBuildingActions(world, collectedActions, buildContext, unit, position, race, pathCoordinates, unitType, unitCommand, handleRallyBase, handleNonRallyBase, getOrderTargetPosition) {
  if (race === Race.PROTOSS && !groupTypes.gasMineTypes.includes(unitType) && pathCoordinates.length >= 2) {
    position = avgPoints([pathCoordinates[pathCoordinates.length - 2], position, position]);
  }
  if (buildContext.rallyBase) {
    collectedActions.push(...handleRallyBase(world, unit, position));
  } else {
    collectedActions.push(...handleNonRallyBase(world, unit, position, unitCommand, unitType, getOrderTargetPosition));
  }
}

/**
 * Morphs a structure.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function morphStructureAction(world, unitType) {
  const { CYCLONE, LAIR } = UnitType;
  const { agent, data } = world;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  if (agent.canAfford(unitType === LAIR ? CYCLONE : unitType)) {
    const { abilityId } = data.getUnitTypeData(unitType);
    if (abilityId === undefined) return collectedActions;
    const actions = ability(world, abilityId, isIdleOrAlmostIdle);
    if (actions.length > 0) {
      collectedActions.push(...actions);
    }
  }
  EarmarkManager.getInstance().addEarmark(data, data.getUnitTypeData(unitType));
  return collectedActions;
}

/**
 * Moves a builder to a position in preparation for building.
 * @param {World} world 
 * @param {Point2D} position 
 * @param {UnitTypeId} unitType
 * @param {Function} getBuilderFunc
 * @param {Function} getMiddleOfStructureFn
 * @param {Function} getTimeToTargetCostFn
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function premoveBuilderToPosition(world, position, unitType, getBuilderFunc, getMiddleOfStructureFn, getTimeToTargetCostFn) {
  const { constructionAbilities } = groupTypes;
  const { agent, data, resources } = world;
  const { debug, map } = resources.get();
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  position = getMiddleOfStructureFn(position, unitType);
  const timeToTargetCost = getTimeToTargetCostFn(world, unitType);

  if (EarmarkManager.earmarkThresholdReached(data)) return collectedActions;

  EarmarkManager.getInstance().addEarmark(data, data.getUnitTypeData(unitType));
  const adjustedPosition = getMiddleOfStructureFn(position, unitType);
  const builderInfo = getBuilderFunc(world, adjustedPosition);

  if (!builderInfo || !builderInfo.unit.orders || !builderInfo.unit.pos) return collectedActions;

  const { unit, timeToPosition } = builderInfo;
  if (!unit.pos) return collectedActions;

  const pathablePositionsInfo = calculatePathablePositions(resources, unit.pos, position);
  if (!pathablePositionsInfo.closestBaseByPath) return collectedActions;

  const { pathCoordinates, pathableTargetPosition } = pathablePositionsInfo;
  drawDebugPath(debug, map, unit.pos, pathableTargetPosition);

  const buildContext = prepareBuildContext(world, pathablePositionsInfo.closestBaseByPath, position, timeToPosition, unit, timeToTargetCost, unitType);
  const gameState = GameState.getInstance();

  if (gameState.shouldPremoveNow(world, buildContext.timeToTargetCostOrTech, buildContext.timeToPosition)) {
    const pendingConstructionOrder = getPendingOrders(unit).some(order => order.abilityId !== undefined && constructionAbilities.includes(order.abilityId));
    const unitCommand = createUnitCommand(Ability.MOVE, [unit], pendingConstructionOrder);

    handleBuildingActions(
      world,
      collectedActions,
      buildContext,
      unit,
      position,
      agent.race,
      pathCoordinates,
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
