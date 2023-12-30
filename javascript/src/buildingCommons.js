//@ts-check
"use strict";

// External Libraries/Modules
const { UnitType, Ability } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { cellsInFootprint } = require('@node-sc2/core/utils/geometry/plane');
const { createPoint2D } = require('@node-sc2/core/utils/geometry/point');
const { getFootprint } = require('@node-sc2/core/utils/geometry/units');

// Local File Imports
const { buildUnitTypeMap } = require('./gameData');
const GameState = require('./gameState');
const { buildingPositions } = require('./gameStateResources');
const { getDistance } = require('./geometryUtils');
const { getPendingOrders } = require('./utils/commonGameUtils');

/**
 * Retrieves detailed information about a builder unit.
 * @param {{unit: Unit, timeToPosition: number}} builder The builder object with unit and time to position.
 * @returns {{unit: Unit, timeToPosition: number, movementSpeedPerSecond: number}} Information about the builder.
 */
function getBuilderInformation(builder) {
  let { unit, timeToPosition } = builder;
  const { movementSpeed } = unit.data();
  const movementSpeedPerSecond = movementSpeed ? movementSpeed * 1.4 : 0;
  return { unit, timeToPosition, movementSpeedPerSecond };
}

/**
 * @param {World} world
 * @returns {Point2D[]}
 */
function getCurrentlyEnrouteConstructionGrids(world) {
  const { constructionAbilities } = groupTypes;
  const { resources } = world;
  const { units } = resources.get();

  /** @type {Point2D[]} */
  const constructionGrids = [];

  const UnitTypeMap = buildUnitTypeMap(world.data);

  const gameState = GameState.getInstance();

  units.getWorkers().forEach(worker => {
    const { orders } = worker;
    if (orders === undefined) return;

    const allOrders = [...orders, ...(getPendingOrders(worker))];
    const moveOrder = allOrders.find(order => order.abilityId === Ability.MOVE);
    if (moveOrder && moveOrder.targetWorldSpacePos) {
      const intendedConstructionLocation = moveOrder.targetWorldSpacePos;

      // Find corresponding building type
      const buildingStep = [...buildingPositions.entries()].reduce(
        /**
         * @param {[number, Point2D] | null} closestEntry 
         * @param {[number, false | Point2D]} currentEntry 
         * @returns {[number, Point2D] | null}
         */
        (closestEntry, currentEntry) => {
          // If the current entry's second element is not a Point2D, return the current closestEntry.
          if (currentEntry[1] === false || typeof currentEntry[1] === 'boolean') return closestEntry;

          // If closestEntry is null or doesn't exist, return the current entry as it's guaranteed to be of type [number, Point2D].
          if (!closestEntry) return /** @type {[number, Point2D]} */(currentEntry);

          const currentDistance = getDistance(currentEntry[1], intendedConstructionLocation);
          const closestDistance = getDistance(closestEntry[1], intendedConstructionLocation);
          return currentDistance < closestDistance ? /** @type {[number, Point2D]} */(currentEntry) : closestEntry;
        },
        /** @type {[number, Point2D] | null} */(null)
      );

      if (buildingStep) {
        const stepNumber = buildingStep[0];
        const buildingType = gameState.getBuildingTypeByStepNumber(stepNumber);
        if (buildingType !== undefined) {
          const footprint = getFootprint(buildingType);
          if (footprint && 'w' in footprint && 'h' in footprint) {
            constructionGrids.push(...cellsInFootprint(createPoint2D(intendedConstructionLocation), footprint)); // Use the correct variable name
          }
        }
      }
    }

    if (worker.isConstructing() || isPendingContructing(worker)) {
      const foundOrder = allOrders.find(order => order.abilityId && constructionAbilities.includes(order.abilityId));
      if (foundOrder && foundOrder.targetWorldSpacePos) {
        // Find the unit type name associated with the found order's abilityId
        const foundUnitTypeName = Object.keys(UnitTypeMap).find(unitTypeName =>
          UnitTypeMap[unitTypeName] === foundOrder.abilityId
        );

        if (foundUnitTypeName) {
          const footprint = getFootprint(UnitTypeMap[foundUnitTypeName]);
          if (footprint && 'w' in footprint && 'h' in footprint) {
            constructionGrids.push(...cellsInFootprint(createPoint2D(foundOrder.targetWorldSpacePos), footprint));
          }
        }
      }
    }
  });

  return constructionGrids;
}

/**
 * Determines if a position should be kept for building construction.
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitType - The unit type ID for the building.
 * @param {Point2D} position - The position to evaluate.
 * @param {(map: MapResource, unitType: number, position: Point2D) => boolean} isPlaceableAtGasGeyser - Injected dependency from buildingPlacement.js
 * @returns {boolean} - Whether the position should be kept.
 */
function keepPosition(world, unitType, position, isPlaceableAtGasGeyser) {
  const { agent, resources } = world;
  const { race } = agent; if (race === undefined) { return false; }
  const { map, units } = resources.get();

  // Check if the position is valid on the map and for gas geysers
  let validMapPlacement = map.isPlaceableAt(unitType, position) || isPlaceableAtGasGeyser(map, unitType, position);

  // For Protoss, check for Pylon presence if the unit is not a Pylon itself
  if (race === Race.PROTOSS && unitType !== UnitType.PYLON) {
    const pylonExists = units.getById(UnitType.PYLON).some(pylon => pylon.isPowered);
    validMapPlacement = validMapPlacement && pylonExists;
  }

  return validMapPlacement;
}

/**
 * Determines if a unit has pending construction orders.
 * @param {Unit & { pendingOrders?: SC2APIProtocol.UnitOrder[] }} unit - The unit to check.
 * @returns {boolean}
 */
function isPendingContructing(unit) {
  // Safely check if 'pendingOrders' exists and is an array before proceeding
  return Array.isArray(unit.pendingOrders) && unit.pendingOrders.some(o => {
    // Ensure that o.abilityId is defined and is a number before using it in the includes check
    return typeof o.abilityId === 'number' && groupTypes.constructionAbilities.includes(o.abilityId);
  });
}

module.exports = {
  getCurrentlyEnrouteConstructionGrids,
  isPendingContructing,
  keepPosition,
  getBuilderInformation,
};