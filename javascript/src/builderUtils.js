//@ts-check
"use strict"

// builderUtils.js

// External Libraries
const { UnitType } = require("@node-sc2/core/constants");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

// Internal Dependencies
const { keepPosition } = require("./buildingCommons");
const { gatherCandidateWorkersTimeToPosition } = require("./constructionUtils");
const GameState = require("./gameState");
const { getClosestBuilderCandidate, calculateClosestConstructingWorker } = require("./pathfinding");
const { addEarmark } = require("./resourceUtils");
const { calculateMovingOrConstructingNonDronesTimeToPosition } = require("./sharedBuildingUtils");
const { getBuilders, gatherBuilderCandidates, filterMovingOrConstructingNonDrones, filterBuilderCandidates, getBuilderCandidateClusters } = require("./workerUtils");

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
 * Prepares a builder for construction and earmarks resources.
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @param {Point2D} position
 * @returns {Unit | null} The selected builder or null if none found.
 */
function prepareBuilderForConstruction(world, unitType, position) {
  const { agent, data } = world;
  const { race } = agent;

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

/**
 * Command to place a building at the specified position.
 * 
 * @param {World} world The current world state.
 * @param {number} unitType The type of unit/building to place.
 * @param {?Point2D} position The position to place the unit/building, or null if no valid position.
 * @param {(world: World, builder: Unit, unitType: UnitTypeId, position: Point2D) => SC2APIProtocol.ActionRawUnitCommand[]} commandBuilderToConstruct - Injected dependency from constructionUtils.js
 * @param {(world: World, unitType: UnitTypeId, abilityId: AbilityId) => SC2APIProtocol.ActionRawUnitCommand[]} buildWithNydusNetwork - Injected dependency from constructionUtils.js
 * @param {(world: World, position: Point2D, unitType: UnitTypeId, getBuilderFunc: (world: World, position: Point2D) => { unit: Unit; timeToPosition: number; } | undefined) => SC2APIProtocol.ActionRawUnitCommand[]} premoveBuilderToPosition - Injected dependency from buildingPlacement.js
 * @param {(map: MapResource, unitType: UnitTypeId, position: Point2D) => boolean} isPlaceableAtGasGeyser - Injected dependency from buildingPlacement.js
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A promise containing a list of raw unit commands.
 */
function commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const collectedActions = [];

  const unitTypeData = data.getUnitTypeData(unitType);
  if (!unitTypeData || typeof unitTypeData.abilityId === 'undefined') {
    return collectedActions; // return an empty array early
  }

  const abilityId = unitTypeData.abilityId;

  if (position) {
    const unitTypes = data.findUnitTypesWithAbility(abilityId);

    if (!unitTypes.includes(UnitType.NYDUSNETWORK)) {
      if (agent.canAfford(unitType)) {
        position = !keepPosition(world, unitType, position, isPlaceableAtGasGeyser) ? null : position;

        if (position) {
          // Prepare the builder for the task
          const builder = prepareBuilderForConstruction(world, unitType, position);
          if (builder) {
            collectedActions.push(...commandBuilderToConstruct(world, builder, unitType, position));
          } else {
            // No builder found. Handle the scenario or add a fallback mechanism.
          }
        }
      } else {
        // When you cannot afford the structure, you might want to move the builder close to the position 
        // so it's ready when you can afford it. 
        // This logic needs to be implemented if it's the desired behavior.
      }
    } else {
      collectedActions.push(...buildWithNydusNetwork(world, unitType, abilityId));
    }

    const [pylon] = units.getById(UnitType.PYLON);
    if (pylon && typeof pylon.buildProgress !== 'undefined' && pylon.buildProgress < 1 && pylon.pos && typeof pylon.unitType !== 'undefined') {
      collectedActions.push(...premoveBuilderToPosition(world, pylon.pos, pylon.unitType, getBuilder));
    }
  }
  return collectedActions;
}

module.exports = {
  getBuilder,
  prepareBuilderForConstruction,
  commandPlaceBuilding,
};
