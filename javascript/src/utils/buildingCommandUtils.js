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
 * @param {?Point2D} position The position to place the unit/building, or null if no valid position.
 * @param {(world: World, builder: Unit, unitType: UnitTypeId, position: Point2D) => SC2APIProtocol.ActionRawUnitCommand[]} commandBuilderToConstruct - Injected dependency from constructionUtils.js
 * @param {(world: World, unitType: UnitTypeId, abilityId: AbilityId) => SC2APIProtocol.ActionRawUnitCommand[]} buildWithNydusNetwork - Injected dependency from constructionUtils.js
 * @param {(world: World, position: Point2D, unitType: UnitTypeId, getBuilderFunc: (world: World, position: Point2D) => { unit: Unit; timeToPosition: number } | undefined, getMiddleOfStructureFn: (position: Point2D, unitType: UnitTypeId) => Point2D, getTimeToTargetCostFn: (world: World, unitType: UnitTypeId) => number) => SC2APIProtocol.ActionRawUnitCommand[]} premoveBuilderToPosition - Injected dependency from buildingHelpers.js
 * @param {(map: MapResource, unitType: UnitTypeId, position: Point2D) => boolean} isPlaceableAtGasGeyser - Injected dependency from buildingPlacement.js
 * @param {(world: World, unitType: UnitTypeId) => number} getTimeToTargetCost - Injected dependency from resourceManagement.js
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of raw unit commands.
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

  if (!agent.canAfford(unitType) || !agent.hasTechFor(unitType)) {
    collectedActions.push(...handleCannotAffordBuilding(world, position, unitType, premoveBuilderToPosition, getTimeToTargetCost));
    return collectedActions;
  }

  if (!keepPosition(world, unitType, position, isPlaceableAtGasGeyser)) {
    return collectedActions;
  }

  const requiresPower = requiresPylonPower(unitType, world);
  const powerSources = agent.powerSources || [];
  if (requiresPower && !isPositionPowered(position, powerSources)) {
    collectedActions.push(...premoveBuilderToPosition(world, position, unitType, getBuilder, BuildingPlacement.getMiddleOfStructure, getTimeToTargetCost));
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
