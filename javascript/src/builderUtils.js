//@ts-check
"use strict"

// builderUtils.js
const { UnitType } = require("@node-sc2/core/constants");
const GameState = require("./gameState");
const { getClosestBuilderCandidate, calculateClosestConstructingWorker } = require("./pathfinding");
const { getBuilders, gatherBuilderCandidates, filterMovingOrConstructingNonDrones, filterBuilderCandidates, getBuilderCandidateClusters } = require("./workerUtils");
const { commandBuilderToConstruct, buildWithNydusNetwork } = require("./constructionUtils");
const { keepPosition } = require("./buildingCommons");

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
      expansionManagementService.setAvailableExpansions([]);
    }

    return unit;
  }

  return null;
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
 * Command to place a building at the specified position.
 * 
 * @param {World} world The current world state.
 * @param {number} unitType The type of unit/building to place.
 * @param {?Point2D} position The position to place the unit/building, or null if no valid position.
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} A promise containing a list of raw unit commands.
 */
async function commandPlaceBuilding(world, unitType, position) {
  const { agent, data, resources } = world;
  const { actions, units } = resources.get();
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
        const canPlaceOrFalse = await actions.canPlace(unitType, [position]);
        position = (canPlaceOrFalse === false && !keepPosition(world, unitType, position)) ? null : position;

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
      collectedActions.push(...await buildWithNydusNetwork(world, unitType, abilityId));
    }

    const [pylon] = units.getById(UnitType.PYLON);
    if (pylon && typeof pylon.buildProgress !== 'undefined' && pylon.buildProgress < 1 && pylon.pos && typeof pylon.unitType !== 'undefined') {
      collectedActions.push(...premoveBuilderToPosition(world, pylon.pos, pylon.unitType, getBuilder));
      planService.pausePlan = true;
      planService.continueBuild = false;
    }
  }
  return collectedActions;
}

module.exports = {
  getBuilder,
  prepareBuilderForConstruction,
  commandPlaceBuilding,
};
