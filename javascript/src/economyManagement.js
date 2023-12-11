//@ts-check
"use strict"

// economyManagement.js

// External library imports
const { UnitType } = require('@node-sc2/core/constants');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
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
const { addEarmark, getMineralFieldsNearby, getGasGeysersNearby } = require('./resourceUtils');
// Unit management and actions
const { calculateDistance } = require('./sharedUtils');
const { prepareUnitToBuildAddon } = require('./unitActions');
const { getUnitsCapableToAddOn, getTimeUntilUnitCanBuildAddon, addAddOn, train, getProductionUnits } = require('./unitManagement');
const { createUnitCommand, isSupplyNeeded, canBuild } = require('./utils');
const config = require('../config/config');

/**
 * Calculates the maximum number of workers based on current game conditions, 
 * considering the build progress of the townhalls and gas structures.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {number} - The calculated maximum number of workers.
 */
function calculateMaxWorkers(units) {
  const bases = units.getBases();
  let totalMaxWorkers = 0;
  const playerAlliance = Alliance.SELF; // Assuming SELF alliance for player-owned units

  bases.forEach(base => {
    const basePos = base.pos;
    const baseBuildProgress = base.buildProgress || 0;

    if (!basePos) return;

    const mineralFields = getMineralFieldsNearby(units, basePos);
    const gasGeysers = getGasGeysersNearby(units, basePos);

    let gasWorkerCapacity = 0;
    gasGeysers.forEach(gasGeyser => {
      // Find the nearest gas mining structure to the geyser
      const gasMines = units.getGasMines().filter(gasMine =>
        calculateDistance(gasGeyser.pos, gasMine.pos) <= 1 &&
        gasMine.alliance === playerAlliance // Check if the gas mine is owned by the player
      );
      const gasStructure = gasMines.length > 0 ? gasMines[0] : null;
      const gasBuildProgress = gasStructure?.buildProgress || 0;
      gasWorkerCapacity += gasBuildProgress * 3;
    });

    totalMaxWorkers += baseBuildProgress * (mineralFields.length * 2) + gasWorkerCapacity;
  });

  return totalMaxWorkers;
}

/**
 * Checks if a base is saturated with workers.
 * @param {Unit} base - The base to check for saturation.
 * @returns {boolean} - True if the base is saturated, false otherwise.
 */
function isBaseSaturated(base) {
  const idealHarvesters = base.idealHarvesters || 0;
  const assignedHarvesters = base.assignedHarvesters || 0;
  return assignedHarvesters >= idealHarvesters;
}

/**
 * Trains additional workers if the conditions are met.
 * @param {World} world - The game world context.
 * @param {Agent} agent - The game agent.
 * @param {Unit[]} bases - The bases available for worker training.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - An array of actions for worker training.
 */
function trainAdditionalWorkers(world, agent, bases) {
  const actions = [];
  const currentSupply = agent.foodUsed || 0;
  const supplyCap = agent.foodCap || 0;
  const supplyAvailable = supplyCap - currentSupply;

  for (const base of bases) {
    if (base.isIdle() && !isBaseSaturated(base) && supplyAvailable > 0) {
      const workerType = WorkerRace[agent.race];
      if (workerType) {
        actions.push(...trainWorker(world, workerType));
      }
    }
  }
  return actions;
}

/**
 * Trains a worker at the specified base.
 * @param {World} world - The game world context.
 * @param {number} limit - The maximum number of workers to train.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The list of actions to train workers.
 */
function trainWorker(world, limit = 1) {
  const { agent, data } = world;
  const workerTypeId = WorkerRace[agent.race];
  const collectedActions = [];

  if (canBuild(world, workerTypeId)) {
    const { abilityId, foodRequired } = data.getUnitTypeData(workerTypeId);
    if (abilityId === undefined || foodRequired === undefined) return collectedActions;

    // Use getProductionUnits to accurately identify the units that can produce the workers
    let trainers = getProductionUnits(world, workerTypeId);

    trainers = trainers.slice(0, limit);
    trainers.forEach(trainer => {
      const unitCommand = createUnitCommand(abilityId, [trainer]);
      collectedActions.push(unitCommand);
      // Handle pending orders and resource accounting as necessary
    });

    // Ensure that the actions are executed elsewhere in your code
  }

  return collectedActions;
}

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
  const collectedActions = [];
  const { agent, data, resources } = world;
  const { units } = resources.get();
  const gameState = new GameState();
  const effectiveTargetCount = targetCount === undefined ? Number.MAX_SAFE_INTEGER : targetCount;

  if (gameState.getUnitTypeCount(world, unitType) <= effectiveTargetCount &&
    gameState.getUnitCount(world, unitType) <= effectiveTargetCount) {
    const { race } = agent;
    switch (true) {
      case TownhallRace[race].includes(unitType):
        if (TownhallRace[race].indexOf(unitType) === 0) {
          if (units.getBases().length == 2 && agent.race === Race.TERRAN) {
            // Await the promise and then assign its value to candidatePositions
            candidatePositions = BuildingPlacement.getInTheMain(world, unitType);
            const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);
            if (position === false) {
              console.error(`No valid position found for building type ${unitType}`);
              return collectedActions;
            }
            collectedActions.push(...commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, BuildingPlacement.premoveBuilderToPosition, BuildingPlacement.isPlaceableAtGasGeyser));
          } else {
            const availableExpansions = MapResources.getAvailableExpansions(resources);
            const nextSafeExpansions = getNextSafeExpansions(world, availableExpansions);
            if (nextSafeExpansions.length > 0) {
              candidatePositions.push(nextSafeExpansions[0]);
              const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);

              if (position === false) {
                console.error(`No valid position found for building type ${unitType}`);
                return collectedActions;
              }

              collectedActions.push(...commandPlaceBuilding(world, unitType, position || null, commandBuilderToConstruct, buildWithNydusNetwork, BuildingPlacement.premoveBuilderToPosition, BuildingPlacement.isPlaceableAtGasGeyser));
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
          const position = BuildingPlacement.determineBuildingPosition(world, unitType, candidatePositions);
          if (position === false) {
            console.error(`No valid position found for building type ${unitType}`);
            return collectedActions;
          } else {
            collectedActions.push(...commandPlaceBuilding(world, unitType, position, commandBuilderToConstruct, buildWithNydusNetwork, BuildingPlacement.premoveBuilderToPosition, BuildingPlacement.isPlaceableAtGasGeyser));
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
  const { OVERLORD, PYLON, SUPPLYDEPOT } = UnitType;
  const { agent } = world;
  const { foodUsed, minerals } = agent;
  const actions = []; // Initialize an array to collect actions

  if (foodUsed === undefined || minerals === undefined) return actions;

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
        const supplyDepotActions = build(world, SUPPLYDEPOT, undefined, candidatePositions); // Use undefined instead of null
        actions.push(...supplyDepotActions);
        break;
      }
      case Race.PROTOSS: {
        const candidatePositions = BuildingPlacement.findPlacements(world, PYLON);
        const pylonActions = build(world, PYLON, undefined, candidatePositions); // Use undefined instead of null
        actions.push(...pylonActions);
        break;
      }
      case Race.ZERG: {
        const overlordActions = train(world, OVERLORD);
        actions.push(...overlordActions);
        break;
      }
    }
  }

  return actions;
}

/**
 * Determines if more workers should be trained.
 * @param {number} totalWorkers - The current number of workers.
 * @param {number} maxWorkers - The maximum number of workers.
 * @returns {boolean} - True if more workers should be trained, false otherwise.
 */
function shouldTrainMoreWorkers(totalWorkers, maxWorkers) {
  return totalWorkers < maxWorkers;
}

module.exports = {
  calculateMaxWorkers,
  trainAdditionalWorkers,
  trainWorker,
  build,
  buildSupply,
  shouldTrainMoreWorkers,
};
