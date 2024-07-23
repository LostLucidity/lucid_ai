const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");

const { handleCannotAffordBuilding, getBuilder, prepareBuilderForConstruction, handleSpecialUnits } = require("./builderUtils");
const { findUnitTypesWithAbilityCached, positionIsEqual } = require("./common");
const { logMessageStorage } = require("./logging");
const BuildingPlacement = require("../features/construction/buildingPlacement");
const { calculateDistance } = require("../features/shared/coreUtils");
const { getAddOnPlacement } = require("../features/shared/pathfinding/pathfinding");
const { getDistance } = require("../features/shared/pathfinding/spatialCoreUtils");
const { requiresPylonPower } = require("../features/shared/protossUtils");
const { canLiftOff } = require("../units/management/unitConfig");



/** @type {UnitTypeId | null} */
let lastLoggedUnitType = null;

/**
 * Command to place a building at the specified position.
 * 
 * @param {World} world The current world state.
 * @param {number} unitType The type of unit/building to place.
 * @param {Point2D} position The position to place the unit/building, or null if no valid position.
 * @param {function(World, Unit, UnitTypeId, Point2D): SC2APIProtocol.ActionRawUnitCommand[]} commandBuilderToConstruct - Injected dependency from constructionUtils.js
 * @param {function(World, UnitTypeId, AbilityId): SC2APIProtocol.ActionRawUnitCommand[]} buildWithNydusNetwork - Injected dependency from constructionUtils.js
 * @param {function(World, Point2D, UnitTypeId, function(World, Point2D): { unit: Unit, timeToPosition: number } | undefined, function(Point2D, UnitTypeId): Point2D, function(World, UnitTypeId): number): SC2APIProtocol.ActionRawUnitCommand[]} premoveBuilderToPosition - Injected dependency from buildingHelpers.js
 * @param {function(MapResource, UnitTypeId, Point2D): boolean} isPlaceableAtGasGeyser - Injected dependency from buildingPlacement.js
 * @param {function(World, UnitTypeId): number} getTimeToTargetCost - Injected dependency from resourceManagement.js
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of raw unit commands.
 */
function commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost) {
  const { agent, data } = world;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  if (!position) return collectedActions;

  const unitTypeData = data.getUnitTypeData(unitType);
  if (!unitTypeData?.abilityId) return collectedActions;

  const abilityId = unitTypeData.abilityId;
  if (findUnitTypesWithAbilityCached(data, abilityId).includes(UnitType.NYDUSNETWORK)) {
    return buildWithNydusNetwork(world, unitType, abilityId);
  }

  if (!agent.canAfford(unitType) || !agent.hasTechFor(unitType)) {
    return handleCannotAffordBuilding(world, position, unitType, premoveBuilderToPosition, getTimeToTargetCost);
  }

  if (!keepPosition(world, unitType, position, isPlaceableAtGasGeyser)) {
    return collectedActions;
  }

  if (requiresPylonPower(unitType, world) && !isPositionPowered(position, agent.powerSources || [])) {
    return premoveBuilderToPosition(world, position, unitType, getBuilder, BuildingPlacement.getMiddleOfStructure, getTimeToTargetCost);
  }

  const builder = prepareBuilderForConstruction(world, unitType, position);
  if (!builder) return collectedActions;

  collectedActions.push(...commandBuilderToConstruct(world, builder, unitType, position));
  handleSpecialUnits(world, collectedActions, premoveBuilderToPosition, getTimeToTargetCost);

  return collectedActions;
}


/**
 * Determines a valid position for placing a building.
 * @param {World} world - The game world state.
 * @param {UnitTypeId} unitType - The type of unit to place.
 * @param {Point3D[]} candidatePositions - Array of candidate positions.
 * @param {false | Point2D | undefined} buildingPositionFn - Function to get the building position.
 * @param {(world: World, unitType: UnitTypeId) => Point2D[]} findPlacementsFn - Function to find placements.
 * @param {(world: World, unitType: UnitTypeId, candidatePositions: Point2D[]) => false | Point2D} findPositionFn - Function to find the position.
 * @param {(unitType: UnitTypeId, position: false | Point2D) => void} setBuildingPositionFn - Function to set the building position.
 * @returns {false | Point2D} - The determined building position or false.
 */
function determineBuildingPosition(
  world,
  unitType,
  candidatePositions,
  buildingPositionFn,
  findPlacementsFn,
  findPositionFn,
  setBuildingPositionFn
) {
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

  const position = findPositionFn(world, unitType, candidatePositions);
  if (!position) {
    logNoValidPosition(unitType);
    return false;
  }

  setBuildingPositionFn(unitType, position);
  return position;
}

/**
 * Finds the best position for adding an add-on to a building.
 * @param {World} world - The game world context.
 * @param {Unit} unit - The unit (building) to find an add-on position for.
 * @param {(world: World, unit: Unit, addOnType?: UnitTypeId) => Point2D | undefined} checkAddOnPlacement - Function to check the add-on placement.
 * @param {boolean} logCondition - Whether to log the diagnostic messages.
 * @returns {Point2D | undefined} - The best position for the add-on, or undefined if none found.
 */
function findBestPositionForAddOn(world, unit, checkAddOnPlacement, logCondition = false) {
  const { map } = world.resources.get();
  const { isFlying, pos } = unit;

  if (!isFlying || !pos) return undefined;

  if (logCondition) {
    console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} ${unit.isFlying ? 'is flying' : 'is grounded'} and ${unit.isIdle() ? 'is idle' : 'is busy'} and ${hasAddOn(unit) ? 'has an add-on' : 'does not have an add-on'}`);
  }

  if (unit.isIdle() && !hasAddOn(unit)) {
    if (isFlying) {
      return checkAddOnPlacement(world, unit) || undefined;
    } else {
      const addonPosition = getAddOnPlacement(pos);
      return map.isPlaceableAt(UnitType.REACTOR, addonPosition) ? undefined : addonPosition;
    }
  }

  if (!unit.isIdle() || (unit.buildProgress !== undefined && unit.buildProgress < 1) || hasAddOn(unit)) {
    return undefined;
  }

  if (hasAddOn(unit)) {
    const landingSpot = checkAddOnPlacement(world, unit);
    if (logCondition) {
      console.log(`findBestPositionForAddOn: ${unit.unitType} ${unit.tag} has an add-on and ${landingSpot ? 'has a suitable landing spot' : 'does not have a suitable landing spot'}`);
    }
    return landingSpot || undefined;
  }

  if (canLiftOff(unit)) {
    return checkAddOnPlacement(world, unit) || undefined;
  }

  return undefined;
}

/**
 * Find potential building placements within the main base.
 * @param {World} world - The game world state.
 * @param {UnitTypeId} unitType - The type of unit to place.
 * @returns {Point2D[]} - Array of potential building placements.
 */
function getInTheMain(world, unitType) {
  const { map } = world.resources.get();
  const mainBase = map.getMain();

  if (!mainBase || !mainBase.areas) return [];

  return mainBase.areas.placementGrid.filter(grid => map.isPlaceableAt(unitType, grid));
}

/**
 * Checks if a unit has an add-on.
 * @param {Unit} unit - The unit to check.
 * @returns {boolean} - True if the unit has an add-on, false otherwise.
 */
function hasAddOn(unit) {
  return String(unit.addOnTag) !== '0';
}

/**
 * Determines if a unitType is a gas collector.
 * @param {number} unitType - The unit type ID to check.
 * @returns {boolean} - True if the unit type is a gas collector, false otherwise.
 */
function isGasCollector(unitType) {
  return groupTypes.gasMineTypes.includes(unitType);
}

/**
 * Determines if the geyser at the given position is unoccupied.
 * @param {World} world - The game world state.
 * @param {Point2D} position - The position to check for an unoccupied geyser.
 * @returns {boolean} - True if the geyser is free, false otherwise.
 */
function isGeyserFree(world, position) {
  const gasCollectors = world.resources.get().units.getByType(groupTypes.gasMineTypes);

  return !gasCollectors.some(collector => collector.pos && positionIsEqual(collector.pos, position));
}

/**
 * Determines if a position is suitable for placing a building near a gas geyser.
 * @param {MapResource} map - The map resource.
 * @param {UnitTypeId} unitType - The unit type ID.
 * @param {Point2D} position - The position to evaluate.
 * @returns {boolean} - True if the position is suitable, false otherwise.
 */
function isPlaceableAtGasGeyser(map, unitType, position) {
  return groupTypes.gasMineTypes.includes(unitType) && map.freeGasGeysers().some(gasGeyser => gasGeyser.pos && getDistance(gasGeyser.pos, position) <= 1);
}

/**
 * Checks if the position is powered by any PowerSource.
 * @param {Point2D} position The position to check.
 * @param {Array<SC2APIProtocol.PowerSource>} powerSources The list of power sources to check against.
 * @returns {boolean} True if the position is powered by any power source, false otherwise.
 */
function isPositionPowered(position, powerSources) {
  return powerSources.some(powerSource => {
    if (!powerSource.pos || powerSource.radius === undefined) return false;
    const distance = calculateDistance(powerSource.pos, position);
    return distance <= powerSource.radius;
  });
}

/**
 * Checks if the position is valid for building the specified unit type.
 * @param {World} world - The game world state.
 * @param {UnitTypeId} unitType - The type of unit to place.
 * @param {Point2D} position - The position to check.
 * @param {Function} isPlaceableAtGasGeyser - Function to check if the position is placeable at a gas geyser.
 * @returns {boolean} - True if the position is valid, false otherwise.
 */
function keepPosition(world, unitType, position, isPlaceableAtGasGeyser) {
  const { race } = world.agent;
  if (!race) return false;

  const resources = world.resources.get();
  const map = resources.map;
  const units = resources.units;

  let isPositionValid = map.isPlaceableAt(unitType, position) || isPlaceableAtGasGeyser(map, unitType, position);

  if (race === Race.PROTOSS && ![UnitType.PYLON, UnitType.ASSIMILATOR, UnitType.NEXUS].includes(unitType)) {
    const pylons = units.getById(UnitType.PYLON);
    const pylonExists = pylons.some(pylon =>
      (pylon.isPowered || (pylon.buildProgress !== undefined && pylon.buildProgress < 1) || pylon.buildProgress === 1) &&
      BuildingPlacement.isPylonInRange(pylon, position)
    );
    isPositionValid = isPositionValid && pylonExists;
  }

  return isPositionValid;
}

/**
 * Logs a message indicating no free geysers are available.
 */
function logNoFreeGeysers() {
  if (!logMessageStorage.noFreeGeysersLogged) {
    console.error('No free geysers available for gas collector');
    logMessageStorage.noFreeGeysersLogged = true;
  }
}

/**
 * Logs a message indicating no valid position was found for the given unit type.
 * @param {UnitTypeId} unitType - The unit type ID.
 */
function logNoValidPosition(unitType) {
  if (!logMessageStorage.noValidPositionLogged) {
    console.error(`No valid position found for building type ${unitType}`);
    logMessageStorage.noValidPositionLogged = true;
    lastLoggedUnitType = unitType;
  }
}

/**
 * Resets the log flag for no free geysers.
 */
function resetNoFreeGeysersLogFlag() {
  logMessageStorage.noFreeGeysersLogged = false;
}

/**
 * Resets the log flag for no valid positions.
 */
function resetNoValidPositionLogFlag() {
  logMessageStorage.noValidPositionLogged = false;
}

module.exports = {
  lastLoggedUnitType,
  commandPlaceBuilding,
  determineBuildingPosition,
  findBestPositionForAddOn,
  getInTheMain,
  keepPosition,
  hasAddOn,
  isGasCollector,
  isGeyserFree,
  isPlaceableAtGasGeyser,
  logNoFreeGeysers,
  logNoValidPosition,
  resetNoFreeGeysersLogFlag,
  resetNoValidPositionLogFlag,
};