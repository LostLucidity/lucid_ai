//@ts-check
"use strict"

// economyManagement.js

// External library imports
const { UnitType } = require('@node-sc2/core/constants');
const { Race } = require('@node-sc2/core/constants/enums');
const groupTypes = require('@node-sc2/core/constants/groups');
const { WorkerRace, TownhallRace } = require('@node-sc2/core/constants/race-map');

// Building and construction utilities
const { commandPlaceBuilding } = require('./builderUtils');
const BuildingPlacement = require('./buildingPlacement');
const { findBestPositionForAddOn } = require('./buildingUnitHelpers');
const { morphStructureAction, commandBuilderToConstruct, buildWithNydusNetwork } = require('./constructionUtils');
const { getAbilityIdsForAddons, getUnitTypesWithAbilities } = require('./gameData');
const GameState = require('./gameState');
const MapResources = require('./mapResources');
const { getNextSafeExpansions } = require('./mapUtils');
const { getTimeUntilCanBeAfforded } = require('./resourceManagement');
const { addEarmark } = require('./resourceUtils');
// Unit management and actions
const { prepareUnitToBuildAddon } = require('./unitActions');
const { getUnitsCapableToAddOn, getTimeUntilUnitCanBuildAddon, addAddOn } = require('./unitManagement');
const { createUnitCommand, isSupplyNeeded, canBuild } = require('./utils');
const config = require('../config/config');

/**
 * Trains a worker at the specified base.
 * @param {World} world - The game world context.
 * @param {number} limit - The maximum number of workers to train.
 * @returns {Promise<SC2APIProtocol.ActionRawUnitCommand[]>} - The list of actions to train workers.
 */
async function trainWorker(world, limit = 1) {
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const workerTypeId = WorkerRace[agent.race];
  const collectedActions = [];

  if (canBuild(world, workerTypeId)) {
    const { abilityId, foodRequired } = data.getUnitTypeData(workerTypeId);
    if (abilityId === undefined || foodRequired === undefined) return collectedActions;

    let trainers = [];
    if (agent.race === Race.ZERG) {
      trainers = units.getById(UnitType.LARVA).filter(larva => !larva['pendingOrders'] || larva['pendingOrders'].length === 0);
    } else {
      trainers = units.getById(workerTypeId).filter(unit => unit.isIdle());
    }

    trainers = trainers.slice(0, limit);
    trainers.forEach(trainer => {
      const unitCommand = createUnitCommand(abilityId, [trainer]);
      collectedActions.push(unitCommand);
      // Logic to handle the pending orders and resource accounting
    });

    // Execute the actions
    // You need to implement logic to execute these collected actions
  }

  return collectedActions;
}

/**
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} [targetCount=null]
 * @param {Point2D[]} [candidatePositions=[]]
 * @returns {Promise<void>}
 */
async function build(world, unitType, targetCount = undefined, candidatePositions = []) {
  const { addonTypes } = groupTypes;
  const { BARRACKS, ORBITALCOMMAND, GREATERSPIRE } = UnitType;
  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];
  const { agent, data, resources } = world;
  const { actions, units } = resources.get();
  const gameState = new GameState();
  const effectiveTargetCount = targetCount === undefined ? Number.MAX_SAFE_INTEGER : targetCount;
  if (gameState.getUnitTypeCount(world, unitType) <= effectiveTargetCount &&
    gameState.getUnitCount(world, unitType) <= effectiveTargetCount) {
    const { race } = agent;
    switch (true) {
      case TownhallRace[race].includes(unitType):
        if (TownhallRace[race].indexOf(unitType) === 0) {
          if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
            candidatePositions = await BuildingPlacement.getInTheMain(world, unitType);
            const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);
            if (position === false) {
              // If position is false, handle this as an error or a special case
              // For example, log an error, return, or take some other action
              console.error(`No valid position found for building type ${unitType}`);
              return;
            }

            collectedActions.push(...await commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, BuildingPlacement.premoveBuilderToPosition, BuildingPlacement.isPlaceableAtGasGeyser));
          } else {
            const availableExpansions = MapResources.getAvailableExpansions(resources);
            const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
            if (nextSafeExpansions.length > 0) {
              candidatePositions.push(nextSafeExpansions[0]);
              const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);

              if (position === false) {
                console.error(`No valid position found for building type ${unitType}`);
                return;
              }

              collectedActions.push(...await commandPlaceBuilding(world, unitType, position || null, commandBuilderToConstruct, buildWithNydusNetwork, BuildingPlacement.premoveBuilderToPosition, BuildingPlacement.isPlaceableAtGasGeyser));
            }
          }
        } else {
          const unitTypeToCheckAfford = unitType === ORBITALCOMMAND ? BARRACKS : unitType;
          if (agent.canAfford(unitTypeToCheckAfford)) {
            collectedActions.push(...await morphStructureAction(world, unitType));
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
            await addAddOn(world, fastestAvailableUnit, unitType);
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
            const response = await prepareUnitToBuildAddon(world, fastestAvailableUnit, targetPosition); if (response === undefined) return;
          }
        }
        break;
      }
      default:
        if (unitType === GREATERSPIRE) {
          collectedActions.push(...await morphStructureAction(world, unitType));
        } else {
          const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);

          if (position === false) {
            // Handle the case when no valid position is found
            console.error(`No valid position found for building type ${unitType}`);
            return;
          } else {
            // Now 'position' is guaranteed to be Point2D or null, so it's safe to pass to commandPlaceBuilding
            collectedActions.push(...await commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, BuildingPlacement.premoveBuilderToPosition, BuildingPlacement.isPlaceableAtGasGeyser));
          }
        }
    }
  }
  if (collectedActions.length > 0) {
    const response = await actions.sendAction(collectedActions);
    if (response.result === undefined) return;
  }
}

/**
 * @param {World} world
 * @param {(world: World, limit?: number) => Promise<SC2APIProtocol.ActionRawUnitCommand[]>} trainFunc
 * @returns {Promise<void>} 
 */
async function buildSupply(world, trainFunc) {
  const { OVERLORD, PYLON, SUPPLYDEPOT } = UnitType;
  const { agent } = world;
  const { foodUsed, minerals } = agent;
  if (foodUsed === undefined || minerals === undefined) return;

  const greaterThanPlanSupply = foodUsed > config.planMax.supply;
  const conditions = [
    isSupplyNeeded(world, 0.2) &&
    (greaterThanPlanSupply || minerals > 512) &&
    config.automateSupply,
  ];

  if (conditions.some(condition => condition)) {
    switch (agent.race) {
      case Race.TERRAN: {
        const candidatePositions = BuildingPlacement.findPlacements(world, SUPPLYDEPOT);
        await build(world, SUPPLYDEPOT, undefined, candidatePositions); // Use undefined instead of null
        break;
      }
      case Race.PROTOSS: {
        const candidatePositions = BuildingPlacement.findPlacements(world, PYLON);
        await build(world, PYLON, undefined, candidatePositions); // Use undefined instead of null
        break;
      }
      case Race.ZERG:
        await trainFunc(world, OVERLORD);
        break;
    }
  }
}

module.exports = {
  trainWorker,
  build,
  buildSupply,
};
