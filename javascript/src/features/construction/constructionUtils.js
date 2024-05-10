//@ts-check
"use strict";

// constructionUtils.js

// External library imports
const { UnitType, Ability } = require('@node-sc2/core/constants');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { GasMineRace, WorkerRace } = require('@node-sc2/core/constants/race-map');
const { avgPoints } = require('@node-sc2/core/utils/geometry/point');
const getRandom = require('@node-sc2/core/utils/get-random');

// Internal module imports from './'
const BuildingPlacement = require('./buildingPlacement');
const { stopOverlappingBuilders, handleNonRallyBase } = require('./buildingWorkerInteractions');
// eslint-disable-next-line no-unused-vars
const { addEarmark } = require('../../core/common/buildUtils');
const { earmarkThresholdReached } = require('../../core/common/EarmarkManager');
const cacheManager = require('../../core/utils/cache');
const { getPathablePositionsForStructure, isPlaceableAtGasGeyser, positionIsEqual, createUnitCommand } = require('../../core/utils/common');
const { logMessageStorage } = require('../../core/utils/logging');
const { calculateBaseTimeToPosition, getClosestPositionByPath, getAddOnPlacement, getClosestUnitByPath } = require('../../gameLogic/spatial/pathfinding');
const { getDistanceByPath, getPathCoordinates, getMapPath, getPathablePositions } = require('../../gameLogic/spatial/pathfindingCommon');
const { getMovementSpeed } = require('../../gameLogic/unit/coreUtils');
const { isPendingContructing } = require('../../gameLogic/unit/workerCommonUtils');
const { getClosestPathWithGasGeysers, ability, isIdleOrAlmostIdle, setBuilderLabel, getBuildTimeLeft, handleRallyBase, getOrderTargetPosition, rallyWorkerToTarget, getUnitsFromClustering } = require('../../gameLogic/utils/economy/workerService');
const { GameState } = require('../../gameState');
const { checkAddOnPlacement } = require('../../services/ConstructionSpatialService');
const { getPendingOrders } = require('../../sharedServices');
const { canLiftOff, unitTypeTrainingAbilities } = require('../../units/management/unitConfig');
const { setPendingOrders } = require('../../units/management/unitOrders');
const { getTimeToTargetTech } = require('../misc/gameData');

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
 * Retrieves pathable positions from start to target, ensuring the closest base and paths are found.
 * @param {ResourceManager} resources
 * @param {Point2D} startPos
 * @param {Point2D} targetPos
 * @returns {{ closestBaseByPath: Unit, pathCoordinates: Point2D[], pathableTargetPosition: Point2D }}
 */
function calculatePathablePositions(resources, startPos, targetPos) {
  const pathableInfo = getClosestPathWithGasGeysers(resources, startPos, targetPos);
  // Ensure we always have an array, use an empty array as a fallback
  const basesWithProgress = cacheManager.getCompletedBases() || [];

  // Pass the (possibly empty) array to getClosestBaseByPath
  const closestBaseByPath = getClosestBaseByPath(resources, pathableInfo.pathableTargetPosition, basesWithProgress);

  return {
    closestBaseByPath,
    pathCoordinates: pathableInfo.pathCoordinates,
    pathableTargetPosition: pathableInfo.pathableTargetPosition
  };
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
 * Determines a valid position for placing a building.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {Point3D[]} candidatePositions
 * @param {false | Point2D | undefined} buildingPositionFn
 * @param {(world: World, unitType: UnitTypeId) => Point2D[]} findPlacementsFn
 * @param {(world: World, unitType: UnitTypeId, candidatePositions: Point2D[]) => false | Point2D} findPositionFn
 * @param {(unitType: UnitTypeId, position: false | Point2D) => void} setBuildingPositionFn
 * @returns {false | Point2D}
 */
function determineBuildingPosition(world, unitType, candidatePositions, buildingPositionFn, findPlacementsFn, findPositionFn, setBuildingPositionFn) {
  if (buildingPositionFn && keepPosition(world, unitType, buildingPositionFn, isPlaceableAtGasGeyser)) {
    setBuildingPositionFn(unitType, buildingPositionFn);
    return buildingPositionFn;
  }

  if (isGasCollector(unitType)) {
    candidatePositions = findPlacementsFn(world, unitType).filter(pos => isGeyserFree(world, pos));
    if (candidatePositions.length === 0) {
      logNoFreeGeysers();
      return false;
    }
  } else if (candidatePositions.length === 0) {
    candidatePositions = findPlacementsFn(world, unitType);
  }

  let position = findPositionFn(world, unitType, candidatePositions);
  if (!position) {
    console.error(`No valid position found for building type ${unitType}`);
    return false;
  }

  setBuildingPositionFn(unitType, position);
  return position;
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
 * @param {World} world
 * @param {Unit} unit 
 * @param {boolean} logCondition
 * @returns {Point2D | undefined}
 */
function findBestPositionForAddOn(world, unit, logCondition = false) {
  const { resources } = world;
  const { map } = resources.get();
  const { isFlying, pos } = unit; if (isFlying === undefined || pos === undefined) return undefined;

  // use logCondition to log the reason why the function returned undefined
  if (logCondition) {
    console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} ${unit.isFlying ? 'is flying' : 'is grounded'} and ${unit.isIdle() ? 'is idle' : 'is busy'} and ${hasAddOn(unit) ? 'has an add-on' : 'does not have an add-on'}`);
  }

  // Scenario 0: The building is idle, doesn't have an add-on, and is flying.
  if (unit.isIdle() && !hasAddOn(unit) && isFlying) {
    const landingSpot = checkAddOnPlacement(world, unit);
    if (landingSpot !== undefined) {
      // If a suitable landing spot is available, return it
      return landingSpot;
    } else {
      // If no suitable landing spot is available, we can't handle this scenario
      return undefined;
    }
  }

  // Scenario 1: The building is idle, doesn't have an add-on, and is grounded.
  if (unit.isIdle() && !hasAddOn(unit) && !isFlying) {
    const addonPosition = getAddOnPlacement(pos); // get the position where the add-on would be built
    if (map.isPlaceableAt(UnitType.REACTOR, addonPosition)) { // check if the add-on can be placed there
      return undefined; // The building is idle and can build an add-on, return null and check it again later.
    }
  }

  // Scenario 2: The building is busy but will become idle after current action.
  if (!unit.isIdle() && !hasAddOn(unit)) {
    // Here, it depends on the urgency of the add-on and your strategy
    // You might wait for the unit to be idle or cancel the current action
    // Then, it becomes Scenario 1 again.
    // For simplicity, we assume we wait until it's idle and can use the same logic to find position
    return undefined; // The building is currently busy, return null and check it again later.
  }

  // Scenario 3: The building is under construction.
  if (unit.buildProgress !== undefined && unit.buildProgress < 1) {
    // The building is still being constructed, so it cannot build an add-on yet.
    // Similar to Scenario 2, we will check it again later.
    return undefined;
  }

  // Scenario 4: The building already has an add-on.
  if (hasAddOn(unit)) {
    // Find a suitable landing spot
    const landingSpot = checkAddOnPlacement(world, unit);
    if (logCondition) {
      console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} has an add-on and ${landingSpot ? 'has a suitable landing spot' : 'does not have a suitable landing spot'}`);
    }
    if (landingSpot !== undefined) {
      // If a suitable landing spot is available, return it
      return landingSpot;
    } else {
      // If no suitable landing spot is available, we can't handle this scenario
      return undefined;
    }
  }

  // Scenario 5: The building can lift off and there is a nearby location with enough space.
  if (canLiftOff(unit)) {
    // You will have to define the function findNearbyLocationWithSpace()
    // which finds a nearby location with enough space for the building and an add-on.
    const newLocation = checkAddOnPlacement(world, unit);
    if (newLocation) {
      // In this case, you will want to move your unit to the new location before building the add-on.
      // You might want to store this information (that the unit needs to move before building the add-on) somewhere.
      return newLocation;
    }
  }

  // If no suitable position was found, return null
  return undefined;
}

/**
 * Finds and returns the closest pathable positions for a base and a target position within the game map.
 * If the base position is undefined, it will handle the error by returning undefined positions.
 * @param {World} world - The game world containing all data and state.
 * @param {Unit} base - The base unit from which the positions are to be pathed. The position may be undefined.
 * @param {Point2D} targetPosition - The target position to check for pathability.
 * @returns {{pathableBasePosition: Point2D | undefined, pathableTargetPosition: Point2D | undefined}} - The closest pathable positions for both base and target, or undefined if base position is not available.
 */
function findPathablePositions(world, base, targetPosition) {
  const { map } = world.resources.get();

  if (!base.pos) {
    console.error("Base position is undefined, cannot determine pathable positions.");
    return { pathableBasePosition: undefined, pathableTargetPosition: undefined };
  }

  // Get pathable positions around the base
  const basePathablePositions = getPathablePositionsForStructure(map, base);
  const pathableBasePosition = getClosestPositionByPath(world.resources, base.pos, basePathablePositions)[0];

  // Calculate pathable positions around the target separately
  const targetPathablePositions = getPathablePositions(map, targetPosition);
  const pathableTargetPosition = getClosestPositionByPath(world.resources, targetPosition, targetPathablePositions)[0];

  return { pathableBasePosition, pathableTargetPosition };
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
 * Finds the closest base by path to a given position from a list of bases.
 * @param {ResourceManager} resources 
 * @param {Point2D} targetPos 
 * @param {Unit[]} bases 
 * @returns {Unit}
 */
function getClosestBaseByPath(resources, targetPos, bases) {
  return getClosestUnitByPath(resources, targetPos, bases)[0];
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
 * Find potential building placements within the main base.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @returns {Point2D[]}
 */
function getInTheMain(world, unitType) {
  const { map } = world.resources.get();
  const mainBase = map.getMain();

  if (!mainBase || !mainBase.areas) {
    return []; // Return an empty array if mainBase or its areas are undefined
  }

  // Filter the placement grid to find suitable positions
  return mainBase.areas.placementGrid.filter(grid => map.isPlaceableAt(unitType, grid));
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
 * Checks if a unit has an add-on.
 * @param {Unit} unit
 * @returns {boolean}
 */
function hasAddOn(unit) {
  return String(unit.addOnTag) !== '0';
}

/**
 * Helper function to determine if a unitType is a gas collector
 * @param {number} unitType - The unit type ID to check
 * @returns {boolean} - Returns true if the unit type is a gas collector, false otherwise
 */
function isGasCollector(unitType) {
  return groupTypes.gasMineTypes.includes(unitType);
}

/**
 * Determines if the geyser at the given position is unoccupied.
 * @param {World} world - The game world state.
 * @param {Point2D} position - The position to check for an unoccupied geyser.
 * @returns {boolean} - Returns true if the geyser is free, false otherwise.
 */
function isGeyserFree(world, position) {
  // Retrieve all gas collectors on the map from 'world'
  const gasCollectors = world.resources.get().units.getByType(groupTypes.gasMineTypes);

  // Check if any gas collector is at 'position'
  for (const collector of gasCollectors) {
    // Ensure collector position is defined before comparing
    if (collector.pos && positionIsEqual(collector.pos, position)) {
      return false; // There's a gas collector at 'position'
    }
  }

  // If no gas collector is found at 'position', the geyser is free
  return true;
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
 * Determines if a position should be kept for building construction.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The unit type ID for the building.
 * @param {Point2D} position - The position to evaluate.
 * @param {(map: MapResource, unitType: number, position: Point2D) => boolean} isPlaceableAtGasGeyser - Dependency for gas geyser placement.
 * @returns {boolean} - Whether the position should be kept.
 */
function keepPosition(world, unitType, position, isPlaceableAtGasGeyser) {
  const { race } = world.agent;
  if (race === undefined) return false;

  const { map } = world.resources.get();
  let isPositionValid = map.isPlaceableAt(unitType, position) || isPlaceableAtGasGeyser(map, unitType, position);

  // Only fetch and process pylons if the race is Protoss and the unit to be placed is not a Pylon
  if (race === Race.PROTOSS && unitType !== UnitType.PYLON) {
    const pylons = world.resources.get().units.getById(UnitType.PYLON);
    const pylonExists = pylons.some(pylon => pylon.isPowered || (pylon.buildProgress !== undefined && pylon.buildProgress <= 1));
    isPositionValid = isPositionValid && pylonExists;
  }

  return isPositionValid;
}

function logNoFreeGeysers() {
  if (!logMessageStorage.noFreeGeysers) {
    console.error('No free geysers available for gas collector');
    logMessageStorage.noFreeGeysers = true;
  } else {
    logMessageStorage.noFreeGeysers = false;
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
  determineBuildingPosition,
  findBestPositionForAddOn,
  gatherCandidateWorkersTimeToPosition,
  getInTheMain,
  hasAddOn,
  morphStructureAction,
  commandBuilderToConstruct,
  buildWithNydusNetwork,
  keepPosition,
  premoveBuilderToPosition
};
