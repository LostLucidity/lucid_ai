// src/utils/buildingCommandUtils.js

const { UnitType } = require('@node-sc2/core/constants');

const { getBuilder, prepareBuilderForConstruction, handleCannotAffordBuilding, handleSpecialUnits } = require('./builderUtils');
const { keepPosition } = require('./buildingPlacementUtils');
const { findUnitTypesWithAbilityCached } = require('./common');
const BuildingPlacement = require('../features/construction/buildingPlacement');
const { calculateDistance } = require('../features/shared/coreUtils');
const { requiresPylonPower } = require('../features/shared/protossUtils');

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

module.exports = {
  commandPlaceBuilding,
  isPositionPowered
};
