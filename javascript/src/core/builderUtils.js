//@ts-check
"use strict"

// builderUtils.js

// External Libraries
const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

// Internal Dependencies
const EarmarkManager = require("./earmarkManager");
const { getBuilders } = require("./workerUtils");
const BuildingPlacement = require("../features/construction/buildingPlacement");
const { calculateClosestConstructingWorker } = require("../features/shared/coreUtils");
const { getClosestBuilderCandidate } = require("../features/shared/pathfinding/pathfinding");
const { gatherCandidateWorkersTimeToPosition } = require("../features/shared/workerManagementUtils");
const { gatherBuilderCandidates, filterMovingOrConstructingNonDrones, filterBuilderCandidates, getBuilderCandidateClusters, calculateMovingOrConstructingNonDronesTimeToPosition } = require("../gameLogic/economy/workerService");
const { GameState } = require('../state');

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

  let builderCandidates = getBuilders(units);
  builderCandidates = gatherBuilderCandidates(units, builderCandidates, position);

  const movingOrConstructingNonDrones = filterMovingOrConstructingNonDrones(units, builderCandidates);
  builderCandidates = filterBuilderCandidates(builderCandidates, movingOrConstructingNonDrones);
  const builderCandidateClusters = getBuilderCandidateClusters(builderCandidates);
  const closestBuilderCandidate = getClosestBuilderCandidate(resources, builderCandidateClusters, position);

  const movingOrConstructingNonDronesTimeToPosition = calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position);
  const candidateWorkersTimeToPosition = closestBuilderCandidate
    ? gatherCandidateWorkersTimeToPosition(resources, position, movingOrConstructingNonDronesTimeToPosition, closestBuilderCandidate, gameState)
    : [];

  const constructingWorkers = units.getConstructingWorkers();
  const closestConstructingWorker = calculateClosestConstructingWorker(world, constructingWorkers, position);

  if (closestConstructingWorker) {
    candidateWorkersTimeToPosition.push(closestConstructingWorker);
  }

  const closestWorker = candidateWorkersTimeToPosition.sort((a, b) => a.timeToPosition - b.timeToPosition)[0];
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
  const units = world.resources.get().units;
  const pylon = units.getById(UnitType.PYLON)[0];

  if (pylon && pylon.pos && typeof pylon.unitType === 'number' && (pylon.buildProgress ?? 0) < 1) {
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
  const race = agent.race || Race.TERRAN;
  const builder = getBuilder(world, position);

  if (builder) {
    const { unit } = builder;
    EarmarkManager.getInstance().addEarmark(data, data.getUnitTypeData(unitType));
    
    if (TownhallRace[race][0] === unitType) {
      GameState.getInstance().setAvailableExpansions([]);
    }

    return unit;
  }

  return null;
}

module.exports = {
  getBuilder,
  handleCannotAffordBuilding,
  handleSpecialUnits,
  prepareBuilderForConstruction,
};
