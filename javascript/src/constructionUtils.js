//@ts-check
"use strict";

// constructionUtils.js

// External library imports
const { UnitType } = require('@node-sc2/core/constants');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { GasMineRace } = require('@node-sc2/core/constants/race-map');
const getRandom = require('@node-sc2/core/utils/get-random');

// Internal module imports from './'
const { isPendingContructing } = require('./buildingCommons');
const BuildingPlacement = require('./buildingPlacement');
const { stopOverlappingBuilders } = require('./buildingSharedUtils');
const { setPendingOrders } = require('./common');
// eslint-disable-next-line no-unused-vars
const GameState = require('./gameState');
const { addEarmark } = require('./resourceUtils');
const { setBuilderLabel } = require('./sharedBuildingUtils');
const { getMovementSpeed, getClosestPathWithGasGeysers, ability } = require('./sharedUtils');
const { createUnitCommand } = require('./utils');
const { isIdleOrAlmostIdle } = require('./workerUtils');

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
 * @param {World} world 
 * @param {UnitTypeId} unitType
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>}
 */
async function morphStructureAction(world, unitType) {
  const { CYCLONE, LAIR } = UnitType;
  const { agent, data } = world;
  const collectedActions = [];
  // use unitType for LAIR with CYCLONE when can afford as LAIR data is inflated by the cost of a HATCHERY
  if (agent.canAfford(unitType === LAIR ? CYCLONE : unitType)) {
    const { abilityId } = data.getUnitTypeData(unitType); if (abilityId === undefined) return collectedActions;
    const actions = await ability(world, abilityId, isIdleOrAlmostIdle);
    if (actions.length > 0) {
      collectedActions.push(...actions);
    }
  }
  addEarmark(data, data.getUnitTypeData(unitType));
  return collectedActions;
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

    if (GasMineRace[agent.race] === unitType) {
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
 * Builds a structure using a Nydus Network.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The type of the unit to be built.
 * @param {AbilityId} abilityId - The ability ID for the construction action.
 * @return {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} - A promise that resolves to an array of unit commands.
 */
async function buildWithNydusNetwork(world, unitType, abilityId) {
  const { agent, resources, data } = world;
  const { actions, units } = resources.get();
  const collectedActions = [];
  const foundPosition = BuildingPlacement.getFoundPosition();
  const nydusNetworks = units.getById(UnitType.NYDUSNETWORK, { alliance: Alliance.SELF });

  if (nydusNetworks.length > 0) {
    // randomly pick a nydus network
    const nydusNetwork = getRandom(nydusNetworks);

    if (agent.canAfford(unitType)) {
      if (foundPosition && await actions.canPlace(unitType, [foundPosition])) {
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
 
module.exports = {
  gatherCandidateWorkersTimeToPosition,
  morphStructureAction,
  commandBuilderToConstruct,
  buildWithNydusNetwork,
};
