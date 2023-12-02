//@ts-check
"use strict";

// constructionUtils.js

// Import necessary modules or constants if required
const { UnitType } = require('@node-sc2/core/constants');
const { getPendingOrders, getMovementSpeed, getClosestUnitPositionByPath, getClosestPathWithGasGeysers, ability, getBuildTimeLeft } = require('./sharedUtils');
const GameState = require('./gameState');
const { getStructureAtPosition, getDistance } = require('./geometryUtils');
const MapResources = require('./mapResources');
const { getDistanceByPath, getTimeInSeconds, createUnitCommand } = require('./utils');
const groupTypes = require('@node-sc2/core/constants/groups');
const { unitTypeTrainingAbilities } = require('./unitConfig');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { isIdleOrAlmostIdle } = require('./workerUtils');
const { addEarmark } = require('./resourceUtils');
const { Alliance } = require('@node-sc2/core/constants/enums');
const getRandom = require('@node-sc2/core/utils/get-random');
const BuildingPlacement = require('./buildingPlacement');

/**
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} inSeconds
 * @returns {number}
 */
function getContructionTimeLeft(world, unit, inSeconds = true) {
  const { constructionAbilities } = groupTypes;
  const { data, resources } = world;
  const { units } = resources.get();
  const { orders } = unit; if (orders === undefined) return 0;
  const constructingOrder = orders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId)); if (constructingOrder === undefined) return 0;
  const { targetWorldSpacePos, targetUnitTag } = constructingOrder; if (targetWorldSpacePos === undefined && targetUnitTag === undefined) return 0;
  const unitTypeBeingConstructed = constructingOrder.abilityId && unitTypeTrainingAbilities.get(constructingOrder.abilityId); if (unitTypeBeingConstructed === undefined) return 0;
  let buildTimeLeft = 0;
  let targetPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined; if (targetPosition === undefined) return 0;
  const unitAtTargetPosition = units.getStructures().find(unit => unit.pos && getDistance(unit.pos, targetPosition) < 1);
  const { buildTime } = data.getUnitTypeData(unitTypeBeingConstructed); if (buildTime === undefined) return 0;
  if (unitAtTargetPosition !== undefined) {
    const progress = unitAtTargetPosition.buildProgress; if (progress === undefined) return 0;
    buildTimeLeft = getBuildTimeLeft(unitAtTargetPosition, buildTime, progress);
  } else {
    buildTimeLeft = buildTime;
  }
  if (inSeconds) {
    return getTimeInSeconds(buildTimeLeft);
  }
  return buildTimeLeft;
}

/**
 * @param {World} world
 * @param {Unit[]} movingOrConstructingNonDrones 
 * @param {Point2D} position 
 * @returns {{unit: Unit, timeToPosition: number}[]}
 */
function calculateMovingOrConstructingNonDronesTimeToPosition(world, movingOrConstructingNonDrones, position) {
  const { resources } = world;
  const { map, units } = resources.get();
  const { SCV, SUPPLYDEPOT } = UnitType;

  return movingOrConstructingNonDrones.reduce((/** @type {{unit: Unit, timeToPosition: number}[]} */acc, movingOrConstructingNonDrone) => {
    const { orders, pos, unitType } = movingOrConstructingNonDrone;
    if (orders === undefined || pos === undefined || unitType === undefined) return acc;

    orders.push(...getPendingOrders(movingOrConstructingNonDrone));
    const { abilityId, targetWorldSpacePos, targetUnitTag } = orders[0];
    if (abilityId === undefined || (targetWorldSpacePos === undefined && targetUnitTag === undefined)) return acc;

    const movingPosition = targetWorldSpacePos ? targetWorldSpacePos : targetUnitTag ? units.getByTag(targetUnitTag).pos : undefined;
    const gameState = new GameState();
    const movementSpeed = getMovementSpeed(map, movingOrConstructingNonDrone, gameState);
    if (movingPosition === undefined || movementSpeed === undefined) return acc;

    const movementSpeedPerSecond = movementSpeed * 1.4;
    const isSCV = unitType === SCV;
    const constructingStructure = isSCV ? getStructureAtPosition(units, movingPosition) : undefined;
    constructingStructure && MapResources.setPathableGrids(map, constructingStructure, true);

    const pathableMovingPosition = getClosestUnitPositionByPath(resources, movingPosition, pos);
    const movingProbeTimeToMovePosition = getDistanceByPath(resources, pos, pathableMovingPosition) / movementSpeedPerSecond;

    constructingStructure && MapResources.setPathableGrids(map, constructingStructure, false);

    let buildTimeLeft = 0;
    let supplyDepotCells = [];
    if (isSCV) {
      buildTimeLeft = getContructionTimeLeft(world, movingOrConstructingNonDrone);
      const isConstructingSupplyDepot = unitTypeTrainingAbilities.get(abilityId) === SUPPLYDEPOT;
      if (isConstructingSupplyDepot) {
        const [supplyDepot] = units.getClosest(movingPosition, units.getStructures().filter(structure => structure.unitType === SUPPLYDEPOT));
        if (supplyDepot !== undefined) {
          const { pos, unitType } = supplyDepot; if (pos === undefined || unitType === undefined) return acc;
          const footprint = getFootprint(unitType); if (footprint === undefined) return acc;
          supplyDepotCells = cellsInFootprint(pos, footprint);
          supplyDepotCells.forEach(cell => map.setPathable(cell, true));
        }
      }
    }

    const pathablePremovingPosition = getClosestUnitPositionByPath(resources, position, pathableMovingPosition);
    const targetTimeToPremovePosition = getDistanceByPath(resources, pathableMovingPosition, pathablePremovingPosition) / movementSpeedPerSecond;
    supplyDepotCells.forEach(cell => map.setPathable(cell, false));

    const timeToPosition = movingProbeTimeToMovePosition + buildTimeLeft + targetTimeToPremovePosition;

    acc.push({
      unit: movingOrConstructingNonDrone,
      timeToPosition: timeToPosition
    });

    return acc;
  }, []);
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
 * Calculates the remaining time to finish a structure's construction.
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @returns {number} Time left in seconds
 */
function calculateTimeToFinishStructure(data, unit) {
  const { buildProgress } = unit;
  const { buildTime } = data.getUnitTypeData(unit.unitType);
  const timeElapsed = buildTime * buildProgress;
  const timeLeft = getTimeInSeconds(buildTime - timeElapsed);
  return timeLeft;
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
    collectedActions.push(...unitResourceService.stopOverlappingBuilders(units, builder, position));
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
  calculateTimeToFinishStructure,
  calculateMovingOrConstructingNonDronesTimeToPosition,
  gatherCandidateWorkersTimeToPosition,
  morphStructureAction,
  commandBuilderToConstruct,
  buildWithNydusNetwork,
};
