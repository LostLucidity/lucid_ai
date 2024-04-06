//@ts-check
"use strict"

// builderUtils.js

// External Libraries
const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

// Internal Dependencies
const GameState = require("../../core/gameState");
const BuildingPlacement = require("../../features/construction/buildingPlacement");
const { keepPosition } = require("../../features/construction/constructionAndBuildingUtils");
const { gatherCandidateWorkersTimeToPosition } = require("../../features/construction/constructionUtils");
const { calculateClosestConstructingWorker } = require("../../gameLogic/coreUtils");
const { getBuilders } = require("../../gameLogic/sharedWorkerUtils");
const { findUnitTypesWithAbilityCached } = require("../common/utils");
const { addEarmark } = require("../construction/resourceUtils");
const { getClosestBuilderCandidate } = require("../pathfinding/pathfinding");
const { calculateMovingOrConstructingNonDronesTimeToPosition } = require("../worker/sharedBuildingUtils");
const { gatherBuilderCandidates, filterMovingOrConstructingNonDrones, filterBuilderCandidates, getBuilderCandidateClusters } = require("../worker/workerUtils");

/**
 * Command to place a building at the specified position.
 * 
 * @param {World} world The current world state.
 * @param {number} unitType The type of unit/building to place.
 * @param {?Point2D} position The position to place the unit/building, or null if no valid position.
 * @param {(world: World, builder: Unit, unitType: UnitTypeId, position: Point2D) => SC2APIProtocol.ActionRawUnitCommand[]} commandBuilderToConstruct - Injected dependency from constructionUtils.js
 * @param {(world: World, unitType: UnitTypeId, abilityId: AbilityId) => SC2APIProtocol.ActionRawUnitCommand[]} buildWithNydusNetwork - Injected dependency from constructionUtils.js
 * @param {(world: World, position: Point2D, unitType: UnitTypeId, getBuilderFunc: (world: World, position: Point2D) => { unit: Unit; timeToPosition: number } | undefined, getMiddleOfStructureFn: (position: Point2D, unitType: UnitTypeId) => Point2D, getTimeToTargetCostFn: (world: World, unitType: UnitTypeId) => number) => SC2APIProtocol.ActionRawUnitCommand[]} premoveBuilderToPosition - Injected dependency from buildingHelpers.js
 * @param {(map: MapResource, unitType: UnitTypeId, position: Point2D) => boolean} isPlaceableAtGasGeyser - Injected dependency from buildingPlacement.js
 * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCost - Injected dependency from resourceManagement.js
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A promise containing a list of raw unit commands.
 */
function commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost) {
  const { agent, data } = world;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  const unitTypeData = data.getUnitTypeData(unitType);
  if (!unitTypeData?.abilityId) {
    return collectedActions;
  }

  if (!position) {
    return collectedActions;
  }

  const isNydusNetwork = findUnitTypesWithAbilityCached(data, unitTypeData.abilityId).includes(UnitType.NYDUSNETWORK);

  if (isNydusNetwork) {
    collectedActions.push(...buildWithNydusNetwork(world, unitType, unitTypeData.abilityId));
    return collectedActions;
  }

  if (!agent.canAfford(unitType)) {
    collectedActions.push(...handleCannotAffordBuilding(world, position, unitType, premoveBuilderToPosition, getTimeToTargetCost));
    return collectedActions;
  }

  if (!keepPosition(world, unitType, position, isPlaceableAtGasGeyser)) {
    return collectedActions;
  }

  const builder = prepareBuilderForConstruction(world, unitType, position);
  if (!builder) {
    // Handle no builder found scenario
    return collectedActions;
  }

  collectedActions.push(...commandBuilderToConstruct(world, builder, unitType, position));
  handleSpecialUnits(world, collectedActions, premoveBuilderToPosition, getTimeToTargetCost);

  return collectedActions;
}

/**
 * Selects the most suitable builder based on the given position.
 * @param {World} world 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number} | undefined}
 */
function getBuilder(world, position) {
  const { resources } = world;
  const { units } = resources.get();

  const gameState = GameState.getInstance();

  // Define builderCandidates before using it
  let builderCandidates = getBuilders(units);

  builderCandidates = gatherBuilderCandidates(units, builderCandidates, position);
  const movingOrConstructingNonDrones = filterMovingOrConstructingNonDrones(units, builderCandidates);
  builderCandidates = filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones);

  const builderCandidateClusters = getBuilderCandidateClusters(builderCandidates);

  let closestBuilderCandidate = getClosestBuilderCandidate(resources, builderCandidateClusters, position);
  const movingOrConstructingNonDronesTimeToPosition = calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position);

  const candidateWorkersTimeToPosition = gatherCandidateWorkersTimeToPosition(resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilderCandidate, gameState);

  const constructingWorkers = units.getConstructingWorkers();
  const closestConstructingWorker = calculateClosestConstructingWorker(world, constructingWorkers, position);

  if (closestConstructingWorker !== undefined) {
    candidateWorkersTimeToPosition.push(closestConstructingWorker);
  }

  const [closestWorker] = candidateWorkersTimeToPosition.sort((a, b) => {
    if (a === undefined || b === undefined) return 0;
    return a.timeToPosition - b.timeToPosition;
  });

  if (closestWorker === undefined) return;
  return closestWorker;
}

/**
 * Handles the scenario where the agent cannot afford to build a specified unit.
 * 
 * @param {World} world - The current world state.
 * @param {Point2D} position - The intended position for the building.
 * @param {UnitTypeId} unitType - The type of unit to be built.
 * @param {(world: World, position: Point2D, unitType: UnitTypeId, getBuilderFunc: (world: World, position: Point2D) => { unit: Unit; timeToPosition: number } | undefined, getMiddleOfStructureFn: (position: Point2D, unitType: UnitTypeId) => Point2D, getTimeToTargetCostFn: (world: World, unitType: UnitTypeId) => number) => SC2APIProtocol.ActionRawUnitCommand[]} premoveBuilderToPosition - Function to move builder to a position.
 * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCost - Function to get time to target cost.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions for moving the builder.
 */
function handleCannotAffordBuilding(world, position, unitType, premoveBuilderToPosition, getTimeToTargetCost) {
  return premoveBuilderToPosition(world, position, unitType, getBuilder, BuildingPlacement.getMiddleOfStructure, getTimeToTargetCost);
}

/**
 * Handles special unit-specific actions, such as dealing with Pylons in StarCraft II.
 * 
 * @param {World} world - The current world state.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} collectedActions - Collection of actions to be performed.
 * @param {(world: World, position: Point2D, unitType: UnitTypeId, getBuilderFunc: (world: World, position: Point2D) => { unit: Unit; timeToPosition: number } | undefined, getMiddleOfStructureFn: (position: Point2D, unitType: UnitTypeId) => Point2D, getTimeToTargetCostFn: (world: World, unitType: UnitTypeId) => number) => SC2APIProtocol.ActionRawUnitCommand[]} premoveBuilderToPosition - Function to move builder to a position.
 * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCost - Function to get time to target cost.
 * @returns {void} No return value; actions are added to collectedActions.
 */
function handleSpecialUnits(world, collectedActions, premoveBuilderToPosition, getTimeToTargetCost) {
  const units = world.resources.get().units; // Accessing units from the World's ResourceManager
  const [pylon] = units.getById(UnitType.PYLON);

  // Check if pylon, buildProgress, pos, and unitType are defined
  if (pylon && typeof pylon.buildProgress !== 'undefined' && pylon.buildProgress < 1 && pylon.pos && typeof pylon.unitType !== 'undefined') {
    collectedActions.push(...premoveBuilderToPosition(world, pylon.pos, pylon.unitType, getBuilder, BuildingPlacement.getMiddleOfStructure, getTimeToTargetCost));
  }
}

/**
 * Prepares a builder for construction and earmarks resources.
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @param {Point2D} position
 * @returns {Unit | null} The selected builder or null if none found.
 */
function prepareBuilderForConstruction(world, unitType, position) {
  const { agent, data } = world;
  // Provide a default race if 'race' is undefined
  const race = agent.race || Race.TERRAN;

  let builder = getBuilder(world, position);

  if (builder) {
    const { unit } = builder;
    addEarmark(data, data.getUnitTypeData(unitType));
    if (TownhallRace[race].indexOf(unitType) === 0) {
      const gameState = GameState.getInstance();
      gameState.setAvailableExpansions([]);
    }

    return unit;
  }

  return null;
}

module.exports = {
  commandPlaceBuilding,
  getBuilder,
  prepareBuilderForConstruction,
};