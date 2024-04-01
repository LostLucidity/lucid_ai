// buildingService.js
"use strict";

const { UnitType } = require("@node-sc2/core/constants");
const { Race } = require("@node-sc2/core/constants/enums");
const groupTypes = require("@node-sc2/core/constants/groups");
const { TownhallRace } = require("@node-sc2/core/constants/race-map");

const BuildingPlacement = require("./buildingPlacement");
const { commandBuilderToConstruct, buildWithNydusNetwork, morphStructureAction } = require("./constructionUtils");
const config = require("../../../config/config");
const GameState = require("../../core/gameState");
const MapResources = require("../../core/mapResources");
const { getUnitsCapableToAddOn, addAddOn } = require("../../gameLogic/addonUtils");
const { findPlacements, findPosition } = require("../../gameLogic/buildingPlacementHelpers");
const { getInTheMain, determineBuildingPosition, premoveBuilderToPosition, findBestPositionForAddOn } = require("../../gameLogic/constructionAndBuildingUtils");
const { getTimeUntilUnitCanBuildAddon } = require("../../gameLogic/unitCapabilityUtils");
const { commandPlaceBuilding } = require("../../utils/common/builderUtils");
const { getNextSafeExpansions } = require("../../utils/common/geometry");
const { prepareUnitToBuildAddon } = require("../../utils/common/unitActions");
const { isPlaceableAtGasGeyser } = require("../../utils/common/utils");
const { getAbilityIdsForAddons, getUnitTypesWithAbilities } = require("../../utils/gameLogic/gameData");
const { getTimeToTargetCost, getTimeUntilCanBeAfforded } = require("../../utils/resourceManagement/resourceManagement");
const { addEarmark } = require("../../utils/resourceManagement/resourceUtils");

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} [targetCount=null]
 * @param {Point2D[]} [candidatePositions=[]]
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function build(world, unitType, targetCount = undefined, candidatePositions = []) {
  const { addonTypes } = groupTypes;
  const { BARRACKS, ORBITALCOMMAND, GREATERSPIRE } = UnitType;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const gameState = new GameState();
  const effectiveTargetCount = targetCount === undefined ? Number.MAX_SAFE_INTEGER : targetCount;

  // Check if a Pylon is needed and if it exists for Protoss buildings
  if (agent.race === Race.PROTOSS && requiresPylonPower(unitType)) {
    const pylons = units.getByType(UnitType.PYLON);
    if (pylons.length === 0) {
      // Add logic to handle the situation when there are no Pylons
      return collectedActions;
    }
  }

  if (gameState.getUnitTypeCount(world, unitType) <= effectiveTargetCount &&
    gameState.getUnitCount(world, unitType) <= effectiveTargetCount) {
    const { race } = agent;

    // Check if race is defined
    if (race === undefined) {
      console.error('Race is undefined');
      return collectedActions;
    }

    switch (true) {
      case TownhallRace[race].includes(unitType):
        if (TownhallRace[race].indexOf(unitType) === 0) {
          if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
            // Await the promise and then assign its value to candidatePositions
            candidatePositions = getInTheMain(world, unitType);
            const position = determineBuildingPosition(
              world,
              unitType,
              candidatePositions,
              BuildingPlacement.buildingPosition,
              findPlacements,
              findPosition,
              BuildingPlacement.setBuildingPosition
            );
            if (position === false) {
              console.error(`No valid position found for building type ${unitType}`);
              return collectedActions;
            }
            collectedActions.push(...commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost));
          } else {
            const availableExpansions = MapResources.getAvailableExpansions(resources);
            const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
            if (nextSafeExpansions.length > 0) {
              candidatePositions.push(nextSafeExpansions[0]);
              const position = determineBuildingPosition(
                world,
                unitType,
                candidatePositions,
                BuildingPlacement.buildingPosition,
                findPlacements,
                findPosition,
                BuildingPlacement.setBuildingPosition
              );

              if (position === false) {
                console.error(`No valid position found for building type ${unitType}`);
                return collectedActions;
              }

              collectedActions.push(...commandPlaceBuilding(world, unitType, position || null, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost));
            }
          }
        } else {
          const unitTypeToCheckAfford = unitType === ORBITALCOMMAND ? BARRACKS : unitType;
          if (agent.canAfford(unitTypeToCheckAfford)) {
            collectedActions.push(...morphStructureAction(world, unitType));
          }
          addEarmark(data, data.getUnitTypeData(unitType));
        }
        break;
      case addonTypes.includes(unitType): {
        const abilityIds = getAbilityIdsForAddons(data, unitType);
        const canDoTypes = getUnitTypesWithAbilities(data, abilityIds);
        const canDoTypeUnits = units.getById(canDoTypes);
        // First, get the units that can perform the action regardless of affordability
        if (agent.canAfford(unitType)) {
          const allUnits = getUnitsCapableToAddOn(canDoTypeUnits);

          let fastestAvailableUnit = null;
          let fastestAvailableTime = Infinity;

          // Calculate time until each unit can build the add-on
          for (let unit of allUnits) {
            let timeUntilAvailable = getTimeUntilUnitCanBuildAddon(world, unit);
            if (timeUntilAvailable < fastestAvailableTime) {
              fastestAvailableUnit = unit;
              fastestAvailableTime = timeUntilAvailable;
            }
          }

          // If a suitable unit is found, build the add-on with it
          if (fastestAvailableUnit) {
            addEarmark(data, data.getUnitTypeData(unitType));
            collectedActions.push(...addAddOn(world, fastestAvailableUnit, unitType));
          }
        } else {
          const timeUntilCanBeAfforded = getTimeUntilCanBeAfforded(world, unitType);
          const allUnits = getUnitsCapableToAddOn(canDoTypeUnits);

          let fastestAvailableUnit = null;
          let fastestAvailableTime = Infinity;

          // Calculate time until each unit can build the addon
          for (let unit of allUnits) {
            let timeUntilAvailable = getTimeUntilUnitCanBuildAddon(world, unit);
            if (timeUntilAvailable < fastestAvailableTime) {
              fastestAvailableUnit = unit;
              fastestAvailableTime = timeUntilAvailable;
            }
          }
          // Check if we have a suitable unit to build the addon soon
          if (fastestAvailableUnit && fastestAvailableTime >= timeUntilCanBeAfforded) {
            // Prepare the fastest available unit to build the addon
            // TODO: Implement a function to prepare the unit to build the addon
            let targetPosition = findBestPositionForAddOn(world, fastestAvailableUnit);
            collectedActions.push(...prepareUnitToBuildAddon(world, fastestAvailableUnit, targetPosition));
          }
        }
        break;
      }
      default:
        if (unitType === GREATERSPIRE) {
          collectedActions.push(...morphStructureAction(world, unitType));
        } else {
          const position = determineBuildingPosition(
            world,
            unitType,
            candidatePositions,
            BuildingPlacement.buildingPosition,
            findPlacements,
            findPosition,
            BuildingPlacement.setBuildingPosition
          );
          if (position === false) {
            console.error(`No valid position found for building type ${unitType}`);
            return collectedActions;
          } else {
            collectedActions.push(...commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, premoveBuilderToPosition, isPlaceableAtGasGeyser, getTimeToTargetCost));
          }
        }
    }
  }

  return collectedActions;
}

/**
 * @param {World} world
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function buildSupply(world) {
  const { agent } = world;
  const { foodUsed, minerals } = agent;

  // Explicitly define the type of actions
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actions = [];

  if (foodUsed === undefined || minerals === undefined) return actions;

  const isSupplyNeeded = (/** @type {World} */ world, /** @type {number} */ threshold) => {
    const { foodCap, foodUsed } = world.agent;

    // Check if foodCap or foodUsed is undefined before proceeding
    if (foodCap === undefined || foodUsed === undefined) {
      console.error('foodCap or foodUsed is undefined');
      return false;
    }

    return foodCap - foodUsed < threshold;
  };

  const greaterThanPlanSupply = foodUsed > config.planMax.supply;
  const automateSupplyCondition = isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512) &&
    config.automateSupply;

  if (automateSupplyCondition) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositionsTerran = findPlacements(world, UnitType.SUPPLYDEPOT);
        actions.push(...candidatePositionsTerran.map(pos => commandPlaceBuilding(
          world,
          UnitType.SUPPLYDEPOT,
          pos,
          commandBuilderToConstruct,
          buildWithNydusNetwork,
          premoveBuilderToPosition,
          isPlaceableAtGasGeyser,
          getTimeToTargetCost
        )).flat());
        break;
      }
      case Race.PROTOSS: {
        const candidatePositionsProtoss = findPlacements(world, UnitType.PYLON);
        actions.push(...candidatePositionsProtoss.map(pos => commandPlaceBuilding(
          world,
          UnitType.PYLON,
          pos,
          commandBuilderToConstruct,
          buildWithNydusNetwork,
          premoveBuilderToPosition,
          isPlaceableAtGasGeyser,
          getTimeToTargetCost
        )).flat());
        break;
      }
      case Race.ZERG: {
        // Zerg supply logic...
        break;
      }
    }
  }

  return actions;
}

// Export the functions to be used by other modules
module.exports = {
  buildSupply,
  build
};

/**
 * Checks if the given Protoss unit type requires Pylon power.
 * @param {UnitTypeId} unitType The type of the Protoss unit.
 * @returns {boolean} True if the unit requires Pylon power, false otherwise.
 */
function requiresPylonPower(unitType) {
  const noPylonRequired = [UnitType.NEXUS, UnitType.ASSIMILATOR, UnitType.PYLON];
  return !noPylonRequired.includes(unitType);
}
