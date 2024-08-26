"use strict";

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Upgrade, Ability, Buff } = require('@node-sc2/core/constants');
const { BUILD_ASSIMILATOR, EFFECT_CALLDOWNMULE } = require('@node-sc2/core/constants/ability');
const { DisplayType } = require('@node-sc2/core/constants/enums');
const { ASSIMILATOR, PROBE, ORBITALCOMMAND } = require('@node-sc2/core/constants/unit-type');
const { performance } = require('perf_hooks');

// Internal module imports
const { resetNoFreeGeysersLogFlag, lastLoggedUnitType, resetNoValidPositionLogFlag } = require('./core/buildingUtils');
const cacheManager = require('./core/cache');
const logger = require('./core/logger');
const ActionCollector = require('./features/actions/actionCollector');
const { midGameTransition } = require('./features/strategy/midGameTransition');
const StrategyManager = require('./features/strategy/strategyManager');
const { startTrackingWorkerGathering, calculateGatheringTime } = require('./gameLogic/economy/gatheringManagement');
const { gather, balanceWorkers, assignWorkers } = require('./gameLogic/economy/workerAssignment');
const { releaseWorkerFromBuilding, getWorkerReservedForPosition } = require('./gameLogic/economy/workerService');
const GameInitialization = require('./initialization/gameInitialization');
const WallOffService = require('./services/wallOffService');
const { GameState } = require('./state');
const buildOrderState = require('./state/buildOrderState');
const { getDistance } = require('./utils/spatialCoreUtils');
const { findUnitPlacements } = require('./utils/spatialUtils');
const { clearAllPendingOrders } = require('./utils/unitUtils');
const config = require('../config/config');
const { isStepInProgress } = require('../data/buildOrders/buildOrderUtils');


/**
 * @typedef {Object} CacheManager
 * @property {Function} updateCompletedBasesCache - Updates the cache of completed bases.
 */

/**
 * @typedef {Object} UpgradeProgress
 * @property {number} upgradeType
 * @property {boolean} inProgress
 */

const buildOrderCompletion = new Map();
const completedBasesMap = new Map();
const gameState = GameState.getInstance();

let averageGatheringTime = config.getAverageGatheringTime();
let cumulativeGameTime = 0;
let gameStartTime = performance.now();
let lastCheckTime = gameStartTime;
let lastLogTime = 0;
/** @type {WallOffService | undefined} */
let wallOffService;
const LOG_INTERVAL = 5; // Log every 5 seconds
const REAL_TIME_CHECK_INTERVAL = 60 * 1000;
const BASE_BUFFER_TIME_SECONDS = 15;
const ADDITIONAL_BUFFER_PER_ACTION_SECONDS = 5;
const MARGIN_OF_ERROR_SECONDS = 5;

let previousFreeGeysersCount = 0;
let previousValidPositionsCount = 0;

/**
 * Assign workers to mineral fields.
 * @param {ResourceManager} resources
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function assignWorkersToMinerals(resources, actionList) {
  actionList.push(...assignWorkers(resources));
}

/**
 * Checks and updates the build order progress.
 * @param {World} world - The current game world state.
 * @param {import('./core/globalTypes').BuildOrderStep[]} buildOrder - The build order to track and update.
 */
async function checkBuildOrderProgress(world, buildOrder) {
  const currentTimeInSeconds = world.resources.get().frame.timeInSeconds();
  const currentSupply = gameState.getFoodUsed();
  const strategyManager = StrategyManager.getInstance();

  let allStepsCompleted = true;

  buildOrder.forEach((order, index) => {
    const orderStatus = getOrderStatus(order);
    if (orderStatus.completed) return;

    const satisfied = strategyManager.isStepSatisfied(world, order);
    const expectedTimeInSeconds = timeStringToSeconds(order.time);
    const timeDifference = currentTimeInSeconds - expectedTimeInSeconds;
    const supplyDifference = currentSupply - Number(order.supply);
    const timeStatus = getTimeStatus(timeDifference);

    if (satisfied && isStepInProgress(world, order)) {
      handleStepInProgress(
        order, index, currentTimeInSeconds, expectedTimeInSeconds,
        timeStatus, timeDifference, supplyDifference, currentSupply,
        orderStatus
      );
    } else {
      checkAndLogDelayedStep(currentTimeInSeconds, expectedTimeInSeconds, orderStatus, order, index, timeStatus, timeDifference, supplyDifference, currentSupply);
    }

    if (!orderStatus.completed) {
      allStepsCompleted = false;
    }

    buildOrderCompletion.set(order, orderStatus);
  });

  buildOrderState.setBuildOrderCompleted(allStepsCompleted);
}

/**
 * Check if a step is delayed and log it if necessary.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {{completed: boolean, logged: boolean, prematureLogged: boolean}} orderStatus
 * @param {import('./core/globalTypes').BuildOrderStep} order
 * @param {number} index
 * @param {string} timeStatus
 * @param {number} timeDifference
 * @param {number} supplyDifference
 * @param {number} currentSupply
 * @returns {boolean} True if the step is delayed, otherwise false
 */
function checkAndLogDelayedStep(currentTimeInSeconds, expectedTimeInSeconds, orderStatus, order, index, timeStatus, timeDifference, supplyDifference, currentSupply) {
  const isDelayed = currentTimeInSeconds >= expectedTimeInSeconds + BASE_BUFFER_TIME_SECONDS + ADDITIONAL_BUFFER_PER_ACTION_SECONDS && !orderStatus.logged;
  if (isDelayed) {
    logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, false, true, currentSupply);
    orderStatus.logged = true;
  }
  return isDelayed;
}

/**
 * Collect actions from the action collector.
 * @param {World} world
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function collectActions(world, actionList) {
  const actionCollector = new ActionCollector(world);
  actionList.push(...actionCollector.collectActions());
}

/**
 * Collects and handles actions in the game world.
 * 
 * @param {World} world - The current game world state.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 * @param {Array<Unit>} allUnits - The list of all units in the game.
 */
function collectAndHandleActions(world, actionList, allUnits) {
  collectActions(world, actionList);
  updateUpgradesInProgress(allUnits, world);
}

/**
 * Find the closest completed townhall to the worker.
 * @param {Unit} worker - The worker unit.
 * @param {Array<Unit>} townhalls - List of townhall units.
 * @returns {Unit|null} - The closest completed townhall or null if none found.
 */
function findClosestTownhall(worker, townhalls) {
  let closestTownhall = null;
  let shortestDistance = Infinity;

  townhalls.forEach(townhall => {
    if (townhall.buildProgress === 1) { // Check if the townhall is fully completed
      const distance = getDistance(worker.pos, townhall.pos); // Assuming getDistance is a utility function available in your code
      if (distance < shortestDistance) {
        closestTownhall = townhall;
        shortestDistance = distance;
      }
    }
  });

  return closestTownhall;
}

/**
 * Get the status of the order from the buildOrderCompletion map.
 * @param {import('./core/globalTypes').BuildOrderStep} order
 * @returns {{completed: boolean, logged: boolean, prematureLogged: boolean}} The status of the order
 */
function getOrderStatus(order) {
  return buildOrderCompletion.get(order) || { completed: false, logged: false, prematureLogged: false };
}

/**
 * Get the time status based on the time difference.
 * @param {number} timeDifference
 * @returns {string} The time status (ahead/behind schedule).
 */
function getTimeStatus(timeDifference) {
  return timeDifference < 0 ? "ahead of schedule" : "behind schedule";
}

/**
 * Handle idle PROBES near warping ASSIMILATORS.
 * @param {UnitResource} units
 * @param {Array<Unit>} allUnits
 * @param {ResourceManager} resources
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function handleIdleProbesNearWarpingAssimilators(units, allUnits, resources, actionList) {
  const assimilatorsWarpingIn = units.getByType(ASSIMILATOR).filter(assimilator =>
    assimilator.buildProgress !== undefined && assimilator.buildProgress < 1
  );

  if (assimilatorsWarpingIn.length > 0) {
    assimilatorsWarpingIn.forEach(assimilator => {
      const nearbyProbes = allUnits.filter(probe =>
        probe.unitType === PROBE && (!probe.orders || probe.isGathering()) &&
        getDistance(probe.pos, assimilator.pos) < 3
      );

      nearbyProbes.forEach(probe => {
        actionList.push(...gather(resources, probe, null, false));
      });
    });
  }
}

/**
 * Handle the step in progress and log its status.
 * @param {import('./core/globalTypes').BuildOrderStep} order
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {string} timeStatus
 * @param {number} timeDifference
 * @param {number} supplyDifference
 * @param {number} currentSupply
 * @param {{completed: boolean, logged: boolean, prematureLogged: boolean}} orderStatus
 */
function handleStepInProgress(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, currentSupply, orderStatus) {
  const shouldCompleteOrder = currentTimeInSeconds >= expectedTimeInSeconds - MARGIN_OF_ERROR_SECONDS;

  if (shouldCompleteOrder) {
    orderStatus.completed = true;
    logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, false, false, currentSupply);
    return;
  }

  if (!orderStatus.prematureLogged) {
    logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, true, false, currentSupply);
    orderStatus.prematureLogged = true;
  }
}

/**
 * Logs build order step status.
 * @param {import('./core/globalTypes').BuildOrderStep} order - The build order step.
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds - The current game time in seconds.
 * @param {number} expectedTimeInSeconds - The expected time for the order in seconds.
 * @param {string} timeStatus - The time status (ahead/behind schedule).
 * @param {number} timeDifference - The time difference between current and expected time.
 * @param {number} supplyDifference - The supply difference between current and expected supply.
 * @param {boolean} isPremature - Whether the completion is premature.
 * @param {boolean} isDelayed - Whether the step is delayed.
 * @param {number} currentSupply - The current supply value.
 */
function logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, isPremature, isDelayed, currentSupply) {
  const { supply, time, action } = order;
  const formattedCurrentTime = currentTimeInSeconds.toFixed(2);
  const formattedExpectedTime = expectedTimeInSeconds.toFixed(2);
  const formattedTimeDifference = Math.abs(timeDifference).toFixed(2);

  let logMessage;
  if (isDelayed) {
    logMessage = `Build Order Step NOT Completed: Step-${index} Supply-${supply} Time-${time} Action-${action}. Expected by time ${time}, current time is ${formattedCurrentTime} seconds. Current Supply: ${currentSupply}. Time Difference: ${formattedTimeDifference} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`;
    console.warn(logMessage);
  } else {
    logMessage = `Build Order Step ${isPremature ? 'Prematurely ' : ''}Completed: Step-${index} Supply-${supply} Time-${time} Action-${action} at game time ${formattedCurrentTime} seconds. ${isPremature ? `Expected time: ${formattedExpectedTime} seconds. ` : ''}Current Supply: ${currentSupply}. Time Difference: ${formattedTimeDifference} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`;
    console.log(logMessage);
  }
}

/**
 * Log geyser activity.
 * @param {MapResource} map
 */
function logGeyserActivity(map) {
  const currentFreeGeysersCount = map.freeGasGeysers().length;
  if (currentFreeGeysersCount > previousFreeGeysersCount) {
    resetNoFreeGeysersLogFlag();
  }
  previousFreeGeysersCount = currentFreeGeysersCount;
}

/**
 * Log unit positions.
 * @param {World} world
 */
function logUnitPositions(world) {
  if (lastLoggedUnitType) {
    const currentValidPositionsCount = getValidPositionsCount(world, lastLoggedUnitType);
    if (currentValidPositionsCount > previousValidPositionsCount) {
      resetNoValidPositionLogFlag();
    }
    previousValidPositionsCount = currentValidPositionsCount;
  }
}

/**
 * Manages Chrono Boost usage.
 * @param {Agent} bot - The bot instance handling the game.
 * @param {import('./core/globalTypes').BuildOrderStep[]} buildOrder - The build order containing actions and timings.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} actionList - The list of actions to be executed.
 */
function manageChronoBoost(bot, buildOrder, actionList) {
  const world = bot._world;
  const frame = world.resources.get().frame; // Get the frame resource
  const observation = frame.getObservation(); // Get the current observation
  const units = world.resources.get().units;

  // Retrieve the current supply used from playerCommon, default to 0 if undefined
  const currentSupply = observation.playerCommon ? observation.playerCommon.foodUsed ?? 0 : 0;

  const nexuses = units.getById(59).filter(nexus => nexus.buildProgress === 1); // Only include fully constructed Nexuses
  const chronoBoostAbility = Ability.EFFECT_CHRONOBOOSTENERGYCOST;
  const chronoBoostBuff = Buff.CHRONOBOOSTENERGYCOST; // The Chrono Boost buff

  // Check for upcoming critical steps based on supply rather than exact time
  const hasUpcomingCriticalStep = buildOrder.some(order => {
    const orderSupply = Number(order.supply);
    return (
      currentSupply >= orderSupply - 2 && // Give some leeway with supply count
      order.interpretedAction &&
      order.interpretedAction.some(action => action.isChronoBoosted)
    );
  });

  // Find all buildings that are actively working and not already boosted
  const eligibleBuildings = units.getAll().filter(building => {
    return building.isStructure() &&
      building.buildProgress === 1 &&  // Fully constructed
      !building.isIdle() &&            // Actively producing or researching
      !(building.buffIds?.includes(chronoBoostBuff)); // Not already Chrono Boosted
  });

  for (const building of eligibleBuildings) {
    if (building.tag && shouldChronoBoost(buildOrder, currentSupply, building, units)) {
      for (const nexus of nexuses) {
        if (nexus.tag && nexus.energy !== undefined && nexus.energy >= 50) {  // Ensure Nexus has at least 50 energy
          const canUseChronoBoost = !hasUpcomingCriticalStep || nexus.energy >= 100; // Ensure energy is enough for both current and future needs

          if (canUseChronoBoost) {
            actionList.push({
              abilityId: chronoBoostAbility,
              unitTags: [nexus.tag],  // Only push if nexus.tag is defined
              targetUnitTag: building.tag
            });
            return; // Exit after issuing the command to avoid using too much energy at once
          }
        }
      }
    }
  }
}

/**
 * Manages workers, handling idle probes, gathering orders, and other tasks.
 * 
 * @param {UnitResource} units - The resource managing all units in the game.
 * @param {Array<Unit>} allUnits - The list of all units in the game.
 * @param {ResourceManager} resources - The resource manager handling minerals, gas, and other resources.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 * @param {World} world - The current game world state.
 */
function manageWorkers(units, allUnits, resources, actionList, world) {
  queueGatherOrdersForProbes(units, allUnits, resources, actionList);
  handleIdleProbesNearWarpingAssimilators(units, allUnits, resources, actionList);
  balanceWorkers(world, units, resources, actionList);
  assignWorkersToMinerals(resources, actionList);

  // Re-evaluate and ensure workers return minerals to the closest townhall
  const workers = units.getWorkers();
  const townhalls = units.getBases().filter(base => base.buildProgress === 1); // Check if townhall is completed

  workers.forEach(worker => {
    // Check if the worker's orders are defined and if it's carrying minerals
    const isCarryingMinerals = worker.orders && worker.orders.some(order => order.abilityId === Ability.HARVEST_RETURN);
    if (isCarryingMinerals) {
      returnMinerals(worker, townhalls, actionList);
    }
  });

  useOrbitalCommandEnergy(world, actionList);
}

/**
 * Queue gather orders for probes starting ASSIMILATOR warpin.
 * @param {UnitResource} units
 * @param {Array<Unit>} allUnits
 * @param {ResourceManager} resources
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function queueGatherOrdersForProbes(units, allUnits, resources, actionList) {
  const probesWarpingAssimilators = allUnits.filter(probe =>
    probe.unitType === PROBE && probe.orders?.some(order => order.abilityId === BUILD_ASSIMILATOR)
  );

  if (probesWarpingAssimilators.length > 0) {
    const mineralFields = units.getMineralFields();
    probesWarpingAssimilators.forEach(probe => {
      if (probe.pos) { // Ensure probe.pos is defined
        const closestMineralPatch = units.getClosest(probe.pos, mineralFields, 1)[0];
        if (closestMineralPatch) {
          actionList.push(...gather(resources, probe, closestMineralPatch, true));
        }
      }
    });
  }
}

/**
 * Command a worker to return minerals to the closest townhall.
 * @param {Unit} worker - The worker unit carrying minerals.
 * @param {Array<Unit>} townhalls - List of townhall units.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - The list of actions to be executed.
 */
function returnMinerals(worker, townhalls, actionList) {
  const closestTownhall = findClosestTownhall(worker, townhalls);

  if (closestTownhall && worker.tag) { // Ensure worker.tag is defined
    actionList.push({
      abilityId: Ability.HARVEST_RETURN, // The ability to return the resources
      targetUnitTag: closestTownhall.tag, // Target the closest townhall
      unitTags: [worker.tag], // The worker that will perform the action
    });
  } else {
    console.error('No completed townhall found for resource return or worker tag is undefined.');
  }
}

/**
 * Determines if a building should be Chrono Boosted.
 * @param {import('./core/globalTypes').BuildOrderStep[]} buildOrder - The build order.
 * @param {number} currentSupply - The current supply count.
 * @param {Unit} building - The building unit to check.
 * @param {UnitResource} units - The unit resource manager.
 * @returns {boolean} - True if the building should be Chrono Boosted, false otherwise.
 */
function shouldChronoBoost(buildOrder, currentSupply, building, units) {
  // Check if there's a planned Chrono Boost in the build order based on supply rather than time
  const isPlanned = buildOrder.some(order => {
    const orderSupply = Number(order.supply);

    // Ensure building.tag is defined before using it
    if (!building.tag) {
      return false; // Skip if building.tag is undefined
    }

    // Get the unit by tag and check the unitType
    const unit = units.getByTag(building.tag);
    return currentSupply >= orderSupply - 2 && // Check supply proximity instead of time
      order.interpretedAction &&
      order.interpretedAction.some(action =>
        action.isChronoBoosted &&
        unit && unit.unitType === action.unitType
      );
  });

  // Boost the building if it's planned in the build order or it's a high-priority task
  return isPlanned || (building.orders !== undefined && building.orders.length > 0);
}

/**
 * Converts a time string in the format "MM:SS" to seconds.
 * @param {string} timeString - The time string to convert.
 * @returns {number} The corresponding time in seconds.
 */
function timeStringToSeconds(timeString) {
  const [minutes, seconds] = timeString.split(':').map(Number);
  return minutes * 60 + seconds;
}

/**
 * Enum for action results based on the SC2APIProtocol.error.d.ts file
 * @enum {number}
 */
const ActionResult = {
  Success: 1,
  NotSupported: 2,
  Error: 3,
  CantQueueThatOrder: 4,
  Retry: 5,
  Cooldown: 6,
  QueueIsFull: 7,
  RallyQueueIsFull: 8,
  NotEnoughMinerals: 9,
  NotEnoughVespene: 10,
  NotEnoughTerrazine: 11,
  NotEnoughCustom: 12,
  NotEnoughFood: 13,
  FoodUsageImpossible: 14,
  NotEnoughLife: 15,
  NotEnoughShields: 16,
  NotEnoughEnergy: 17,
  LifeSuppressed: 18,
  ShieldsSuppressed: 19,
  EnergySuppressed: 20,
  NotEnoughCharges: 21,
  CantAddMoreCharges: 22,
  TooMuchMinerals: 23,
  TooMuchVespene: 24,
  TooMuchTerrazine: 25,
  TooMuchCustom: 26,
  TooMuchFood: 27,
  TooMuchLife: 28,
  TooMuchShields: 29,
  TooMuchEnergy: 30,
  MustTargetUnitWithLife: 31,
  MustTargetUnitWithShields: 32,
  MustTargetUnitWithEnergy: 33,
  CantTrade: 34,
  CantSpend: 35,
  CantTargetThatUnit: 36,
  CouldntAllocateUnit: 37,
  UnitCantMove: 38,
  TransportIsHoldingPosition: 39,
  BuildTechRequirementsNotMet: 40,
  CantFindPlacementLocation: 41,
  CantBuildOnThat: 42,
  CantBuildTooCloseToDropOff: 43,
  CantBuildLocationInvalid: 44,
  CantSeeBuildLocation: 45,
  CantBuildTooCloseToCreepSource: 46,
  CantBuildTooCloseToResources: 47,
  CantBuildTooFarFromWater: 48,
  CantBuildTooFarFromCreepSource: 49,
  CantBuildTooFarFromBuildPowerSource: 50,
  CantBuildOnDenseTerrain: 51,
  CantTrainTooFarFromTrainPowerSource: 52,
  CantLandLocationInvalid: 53,
  CantSeeLandLocation: 54,
  CantLandTooCloseToCreepSource: 55,
  CantLandTooCloseToResources: 56,
  CantLandTooFarFromWater: 57,
  CantLandTooFarFromCreepSource: 58,
  CantLandTooFarFromBuildPowerSource: 59,
  CantLandOnDenseTerrain: 60,
  AddOnTooFarFromBuilding: 61,
  MustBuildRefineryFirst: 62,
  BuildingIsUnderConstruction: 63,
  CantFindDropOff: 64,
  CantLoadOtherPlayersUnits: 65,
  NotEnoughRoomToLoadUnit: 66,
  CantUnloadUnitsThere: 67,
  CantWarpInUnitsThere: 68,
  CantLoadImmobileUnits: 69,
  CantRechargeImmobileUnits: 70,
  CantRechargeUnderConstructionUnits: 71,
  CantLoadThatUnit: 72,
  NoCargoToUnload: 73,
  LoadAllNoTargetsFound: 74,
  NotWhileOccupied: 75,
  CantAttackWithoutAmmo: 76,
  CantHoldAnyMoreAmmo: 77,
  TechRequirementsNotMet: 78,
  MustLockdownUnitFirst: 79,
  MustTargetUnit: 80,
  MustTargetInventory: 81,
  MustTargetVisibleUnit: 82,
  MustTargetVisibleLocation: 83,
  MustTargetWalkableLocation: 84,
  MustTargetPawnableUnit: 85,
  YouCantControlThatUnit: 86,
  YouCantIssueCommandsToThatUnit: 87,
  MustTargetResources: 88,
  RequiresHealTarget: 89,
  RequiresRepairTarget: 90,
  NoItemsToDrop: 91,
  CantHoldAnyMoreItems: 92,
  CantHoldThat: 93,
  TargetHasNoInventory: 94,
  CantDropThisItem: 95,
  CantMoveThisItem: 96,
  CantPawnThisUnit: 97,
  MustTargetCaster: 98,
  CantTargetCaster: 99,
  MustTargetOuter: 100,
  CantTargetOuter: 101,
  MustTargetYourOwnUnits: 102,
  CantTargetYourOwnUnits: 103,
  MustTargetFriendlyUnits: 104,
  CantTargetFriendlyUnits: 105,
  MustTargetNeutralUnits: 106,
  CantTargetNeutralUnits: 107,
  MustTargetEnemyUnits: 108,
  CantTargetEnemyUnits: 109,
  MustTargetAirUnits: 110,
  CantTargetAirUnits: 111,
  MustTargetGroundUnits: 112,
  CantTargetGroundUnits: 113,
  MustTargetStructures: 114,
  CantTargetStructures: 115,
  MustTargetLightUnits: 116,
  CantTargetLightUnits: 117,
  MustTargetArmoredUnits: 118,
  CantTargetArmoredUnits: 119,
  MustTargetBiologicalUnits: 120,
  CantTargetBiologicalUnits: 121,
  MustTargetHeroicUnits: 122,
  CantTargetHeroicUnits: 123,
  MustTargetRoboticUnits: 124,
  CantTargetRoboticUnits: 125,
  MustTargetMechanicalUnits: 126,
  CantTargetMechanicalUnits: 127,
  MustTargetPsionicUnits: 128,
  CantTargetPsionicUnits: 129,
  MustTargetMassiveUnits: 130,
  CantTargetMassiveUnits: 131,
  MustTargetMissile: 132,
  CantTargetMissile: 133,
  MustTargetWorkerUnits: 134,
  CantTargetWorkerUnits: 135,
  MustTargetEnergyCapableUnits: 136,
  CantTargetEnergyCapableUnits: 137,
  MustTargetShieldCapableUnits: 138,
  CantTargetShieldCapableUnits: 139,
  MustTargetFlyers: 140,
  CantTargetFlyers: 141,
  MustTargetBuriedUnits: 142,
  CantTargetBuriedUnits: 143,
  MustTargetCloakedUnits: 144,
  CantTargetCloakedUnits: 145,
  MustTargetUnitsInAStasisField: 146,
  CantTargetUnitsInAStasisField: 147,
  MustTargetUnderConstructionUnits: 148,
  CantTargetUnderConstructionUnits: 149,
  MustTargetDeadUnits: 150,
  CantTargetDeadUnits: 151,
  MustTargetRevivableUnits: 152,
  CantTargetRevivableUnits: 153,
  MustTargetHiddenUnits: 154,
  CantTargetHiddenUnits: 155,
  CantRechargeOtherPlayersUnits: 156,
  MustTargetHallucinations: 157,
  CantTargetHallucinations: 158,
  MustTargetInvulnerableUnits: 159,
  CantTargetInvulnerableUnits: 160,
  MustTargetDetectedUnits: 161,
  CantTargetDetectedUnits: 162,
  CantTargetUnitWithEnergy: 163,
  CantTargetUnitWithShields: 164,
  MustTargetUncommandableUnits: 165,
  CantTargetUncommandableUnits: 166,
  MustTargetPreventDefeatUnits: 167,
  CantTargetPreventDefeatUnits: 168,
  MustTargetPreventRevealUnits: 169,
  CantTargetPreventRevealUnits: 170,
  MustTargetPassiveUnits: 171,
  CantTargetPassiveUnits: 172,
  MustTargetStunnedUnits: 173,
  CantTargetStunnedUnits: 174,
  MustTargetSummonedUnits: 175,
  CantTargetSummonedUnits: 176,
  MustTargetUser1: 177,
  CantTargetUser1: 178,
  MustTargetUnstoppableUnits: 179,
  CantTargetUnstoppableUnits: 180,
  MustTargetResistantUnits: 181,
  CantTargetResistantUnits: 182,
  MustTargetDazedUnits: 183,
  CantTargetDazedUnits: 184,
  CantLockdown: 185,
  CantMindControl: 186,
  MustTargetDestructibles: 187,
  CantTargetDestructibles: 188,
  MustTargetItems: 189,
  CantTargetItems: 190,
  NoCalldownAvailable: 191,
  WaypointListFull: 192,
  MustTargetRace: 193,
  CantTargetRace: 194,
  MustTargetSimilarUnits: 195,
  CantTargetSimilarUnits: 196,
  CantFindEnoughTargets: 197,
  AlreadySpawningLarva: 198,
  CantTargetExhaustedResources: 199,
  CantUseMinimap: 200,
  CantUseInfoPanel: 201,
  OrderQueueIsFull: 202,
  CantHarvestThatResource: 203,
  HarvestersNotRequired: 204,
  AlreadyTargeted: 205,
  CantAttackWeaponsDisabled: 206,
  CouldntReachTarget: 207,
  TargetIsOutOfRange: 208,
  TargetIsTooClose: 209,
  TargetIsOutOfArc: 210,
  CantFindTeleportLocation: 211,
  InvalidItemClass: 212,
  CantFindCancelOrder: 213,
};

/**
 * @typedef {Object.<number, string>} ActionResultStrings
 */

/**
 * @type {ActionResultStrings}
 */
const actionResultStrings = Object.keys(ActionResult).reduce((acc, key) => {
  const numericKey = ActionResult[/** @type {keyof typeof ActionResult} */ (key)];
  acc[/** @type {number} */ (numericKey)] = key;
  return acc;
}, /** @type {ActionResultStrings} */({}));

/**
 * Executes collected actions and handles any errors.
 * @param {World} world - The current game world state.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionCollection - Actions to be executed.
 */
async function executeActions(world, actionCollection) {
  if (actionCollection.length === 0) return;

  const resources = world.resources.get();
  try {
    const response = await resources.actions.sendAction(actionCollection);

    if (response && response.result) {
      response.result.forEach((result, index) => {
        if (result !== ActionResult.Success) {
          console.error(`Action ${index} failed with result: ${actionResultStrings[result]}`);
        }
      });
    } else {
      console.warn('Response or response.result is undefined.');
    }

    clearAllPendingOrders(resources.units.getAll());
  } catch (error) {
    console.error('Error sending actions in onStep:', error);
  }
}

/**
 * Find the best mineral field to call down a MULE based on proximity to bases and mineral contents.
 * @param {Unit} orbital - The Orbital Command unit.
 * @param {Array<Unit>} baseLocations - The list of base locations.
 * @param {Map<string, Array<{field: Unit, distance: number}>>} baseToMineralDistances - The precomputed distances from bases to mineral fields.
 * @param {Array<Unit>} mineralFields - The list of mineral fields.
 * @param {number} maxDistance - The maximum distance to consider.
 * @returns {Unit|null} - The best mineral field to call down a MULE, or null if none found.
 */
function findBestMineralField(orbital, baseLocations, baseToMineralDistances, mineralFields, maxDistance) {
  let bestMineralField = null;
  let bestScore = -Infinity;

  mineralFields.forEach(field => {
    if (field.mineralContents === undefined) return;

    const orbitalToFieldDistance = getDistance(orbital.pos, field.pos);
    const closestBaseDistance = findClosestBaseDistance(field, baseLocations, baseToMineralDistances);

    if (closestBaseDistance <= maxDistance) {
      const score = field.mineralContents - orbitalToFieldDistance;
      if (score > bestScore) {
        bestScore = score;
        bestMineralField = field;
      }
    }
  });

  return bestMineralField;
}

/**
 * Find the closest distance from a mineral field to any base.
 * @param {Unit} field - The mineral field to check.
 * @param {Array<Unit>} baseLocations - The list of base locations.
 * @param {Map<string, Array<{field: Unit, distance: number}>>} baseToMineralDistances - The precomputed distances from bases to mineral fields.
 * @returns {number} - The closest distance from the mineral field to any base.
 */
function findClosestBaseDistance(field, baseLocations, baseToMineralDistances) {
  let closestBaseDistance = Infinity;

  baseLocations.forEach(base => {
    if (base.tag) { // Ensure base.tag is defined
      const baseToFieldData = baseToMineralDistances.get(base.tag);
      if (baseToFieldData) {
        baseToFieldData.forEach(data => {
          if (data.field.tag === field.tag && data.distance < closestBaseDistance) {
            closestBaseDistance = data.distance;
          }
        });
      }
    }
  });

  return closestBaseDistance;
}

/**
 * Get the count of valid positions for building placements.
 * @param {World} world - The current game world state.
 * @param {UnitTypeId} unitType - The type of the unit to place.
 * @returns {number} - The count of valid positions.
 */
function getValidPositionsCount(world, unitType) {
  const candidatePositions = findUnitPlacements(world, unitType);
  return candidatePositions.length;
}

/**
 * Logs the current game state based on the frame information.
 * 
 * @param {FrameResource} frame - The frame resource containing game loop and timing information.
 */
function logCurrentGameState(frame) {
  const currentGameTime = frame.getGameLoop() / 22.4;
  if (currentGameTime >= lastLogTime + LOG_INTERVAL) {
    logger.logMessage(`Current game time: ${currentGameTime.toFixed(2)}s - Food used: ${gameState.getFoodUsed()}, Bases completed: ${completedBasesMap.size}`, 1);
    lastLogTime = currentGameTime;
  }
}

/**
 * Precompute distances from bases to mineral fields within a specified maximum distance.
 * @param {Array<Unit>} baseLocations - The bases to compute distances from.
 * @param {Array<Unit>} mineralFields - The mineral fields to compute distances to.
 * @param {number} maxDistance - The maximum distance to consider.
 * @returns {Map<string, Array<{field: Unit, distance: number}>>} - A map of base tags to their mineral field distances.
 */
function precomputeBaseToMineralDistances(baseLocations, mineralFields, maxDistance) {
  const baseToMineralDistances = new Map();
  baseLocations.forEach(base => {
    if (base.tag) { // Ensure base.tag is defined
      const distances = mineralFields
        .map(field => ({ field, distance: getDistance(base.pos, field.pos) }))
        .filter(data => data.distance <= maxDistance);
      baseToMineralDistances.set(base.tag, distances);
    }
  });
  return baseToMineralDistances;
}

/**
 * Tracks and logs performance metrics.
 * 
 * @param {FrameResource} frame - The frame resource containing game loop and timing information.
 * @param {GameState} gameState - The game state object.
 * @param {MapResource} map - The map resource for the current game.
 * @param {World} world - The current game world state.
 */
function trackAndLogPerformance(frame, gameState, map, world) {
  trackPerformance(frame, gameState);
  logGeyserActivity(map);
  logUnitPositions(world);
}

/**
 * Tracks the gathering time of workers and updates the average.
 * 
 * @param {Array<Unit>} workers - The list of worker units in the game.
 * @param {World} world - The current game world state.
 */
function trackGatheringTime(workers, world) {
  updateAverageGatheringTime(workers, world);
}

/**
 * Track performance and log warnings if necessary.
 * @param {FrameResource} frame
 * @param {GameState} gameState
 */
function trackPerformance(frame, gameState) {
  const stepEnd = performance.now();
  const realTimeElapsed = (stepEnd - gameStartTime) / 1000;
  const gameTimeElapsed = (frame.getGameLoop() - gameState.lastGameLoop) / 22.4;
  gameState.lastGameLoop = frame.getGameLoop();
  cumulativeGameTime += gameTimeElapsed;

  if (stepEnd - lastCheckTime >= REAL_TIME_CHECK_INTERVAL) {
    if (realTimeElapsed > cumulativeGameTime) {
      console.warn(`Bot is slower than real-time! Cumulative real-time elapsed: ${realTimeElapsed.toFixed(2)}s, Cumulative game-time elapsed: ${cumulativeGameTime.toFixed(2)}s`);
    }
    lastCheckTime = stepEnd;
  }
}

/**
 * Track and calculate average gathering time.
 * @param {Array<Unit>} workers - The list of worker units.
 * @param {World} world - The current game world state.
 */
function updateAverageGatheringTime(workers, world) {
  let totalGatheringTime = 0;
  let gatherCount = 0;
  let sumOfSquares = 0;

  workers.forEach(worker => {
    startTrackingWorkerGathering(worker, world);
    const gatherTime = calculateGatheringTime(worker, world);
    if (gatherTime !== null) {
      gatherCount++;
      totalGatheringTime += gatherTime;
      sumOfSquares += gatherTime * gatherTime;
    }
  });

  if (gatherCount > 0) {
    const mean = totalGatheringTime / gatherCount;
    const variance = (sumOfSquares / gatherCount) - (mean * mean);
    const stdDev = Math.sqrt(variance);

    let adjustedTotal = 0;
    let adjustedCount = 0;

    workers.forEach(worker => {
      const gatherTime = calculateGatheringTime(worker, world);
      if (gatherTime !== null && Math.abs(gatherTime - mean) <= 2 * stdDev) {
        adjustedTotal += gatherTime;
        adjustedCount++;
      }
    });

    if (adjustedCount > 0) {
      const calculatedAverage = adjustedTotal / adjustedCount;
      const smoothingFactor = stdDev / (mean + stdDev);
      averageGatheringTime = (averageGatheringTime || calculatedAverage) * (1 - smoothingFactor) + calculatedAverage * smoothingFactor;
    }
  }
}

/**
 * Update completed bases and cache them.
 * @param {UnitResource} units
 * @param {CacheManager} cacheManager
 */
function updateCompletedBases(units, cacheManager) {
  const newCompletedBases = units.getBases().filter(base => {
    if (base.buildProgress === undefined) {
      return false;
    }
    const isCompleted = base.buildProgress >= 1;
    if (isCompleted && !completedBasesMap.has(base.tag)) {
      completedBasesMap.set(base.tag, true);
      return true;
    }
    return false;
  });

  if (newCompletedBases.length > 0) {
    cacheManager.updateCompletedBasesCache(newCompletedBases);
  }
}

/**
 * Updates the game state, including completed bases and build order progress.
 * 
 * @param {UnitResource} units - The resource managing all units in the game.
 * @param {World} world - The current game world state.
 */
function updateGameState(units, world) {
  updateCompletedBases(units, cacheManager);
  checkBuildOrderProgress(world, gameState.getBuildOrder());
  gameState.setFoodUsed(world);
}

/**
 * Update upgrades in progress.
 * @param {Array<Unit>} allUnits
 * @param {World} world
 */
function updateUpgradesInProgress(allUnits, world) {
  const UPGRADE_ABILITY_IDS = new Map();
  Object.values(Upgrade).forEach(upgradeId => {
    const upgradeData = world.data.getUpgradeData(upgradeId);
    if (upgradeData?.abilityId) {
      UPGRADE_ABILITY_IDS.set(upgradeData.abilityId, upgradeId);
    }
  });

  /**
   * @type {UpgradeProgress[]}
   */
  const upgradesInProgress = allUnits.reduce((acc, unit) => {
    if (unit.isStructure() && unit.orders && unit.orders.length > 0) {
      unit.orders.forEach(order => {
        const upgradeId = UPGRADE_ABILITY_IDS.get(order.abilityId);
        if (upgradeId !== undefined) {
          acc.push({ upgradeType: upgradeId, inProgress: true });
        }
      });
    }
    return acc;
  }, /** @type {UpgradeProgress[]} */([]));

  gameState.updateUpgradesInProgress(upgradesInProgress);
}

/**
 * Use ORBITALCOMMAND energy for calling down MULEs.
 * @param {World} world - The current game world state.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - List of actions to be executed.
 */
function useOrbitalCommandEnergy(world, actionList) {
  const MIN_ENERGY = 50;
  const MAX_DISTANCE = 10;
  const { units } = world.resources.get();
  const orbitalCommands = units.getByType(ORBITALCOMMAND);
  const baseLocations = units.getBases().filter(base => base.buildProgress === 1);
  const mineralFields = units.getMineralFields().filter(field => field.displayType === DisplayType.VISIBLE);

  const baseToMineralDistances = precomputeBaseToMineralDistances(baseLocations, mineralFields, MAX_DISTANCE);

  orbitalCommands.forEach(orbital => {
    if (orbital.energy !== undefined && orbital.energy >= MIN_ENERGY && orbital.tag) { // Ensure orbital.energy and orbital.tag are defined
      const bestMineralField = findBestMineralField(orbital, baseLocations, baseToMineralDistances, mineralFields, MAX_DISTANCE);
      if (bestMineralField) {
        actionList.push({
          abilityId: EFFECT_CALLDOWNMULE,
          targetUnitTag: bestMineralField.tag,
          unitTags: [orbital.tag]
        });
      }
    }
  });
}

const bot = createAgent({
  interface: {
    raw: true, rawCropToPlayableArea: true, score: true, showBurrowedShadows: true, showCloaked: true,
  },

  onGameStart: async (world) => {
    try {
      const gameInit = new GameInitialization(world);
      await gameInit.enhancedOnGameStart();

      // Initialize WallOffService
      wallOffService = new WallOffService(world.resources);

      // Set up the wall-off using the instance method
      wallOffService.setUpWallOffNatural(world);

      // Log initial game state
      const startTime = performance.now();
      gameStartTime = startTime;
      lastCheckTime = startTime;

      const { frame, units, map } = world.resources.get();
      const currentGameLoop = frame.getGameLoop();
      gameState.lastGameLoop = currentGameLoop;

      const completedBases = units.getBases().filter(base => base.buildProgress === 1);
      cacheManager.updateCompletedBasesCache(completedBases);

      previousFreeGeysersCount = map.freeGasGeysers().length;

      if (lastLoggedUnitType) {
        previousValidPositionsCount = getValidPositionsCount(world, lastLoggedUnitType);
      }

      gameState.setFoodUsed(world);

      logger.logMessage(`Game started at ${new Date().toLocaleTimeString()} with map: ${config.defaultMap}`, 1);
      logger.logMessage(`Initial game state: Food used - ${gameState.getFoodUsed()}, Bases completed - ${completedBases.length}`, 1);

    } catch (error) {
      console.error('Error during onGameStart:', error);
    }
  },

  onStep: async (world) => {
    try {
      const { frame, units, map } = world.resources.get();
      const resources = world.resources;
      /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
      const actionList = [];
      const allUnits = units.getAll();
      const workers = units.getWorkers();

      // 1. Update game state and build order progress
      updateGameState(units, world);

      // 2. Log current game time and state
      logCurrentGameState(frame);

      // 3. Track and calculate average gathering time
      trackGatheringTime(workers, world);

      // 4. Handle worker and mineral management
      manageWorkers(units, allUnits, resources, actionList, world);

      // 6. Collect actions and handle upgrades
      collectAndHandleActions(world, actionList, allUnits);

      // 7. Manage Chrono Boost usage
      manageChronoBoost(bot, gameState.getBuildOrder(), actionList);

      // Execute mid-game transition logic if appropriate
      if (buildOrderState.isBuildOrderCompleted()) {
        await midGameTransition(world, actionList);
      }

      // 8. Track performance and log relevant information
      trackAndLogPerformance(frame, gameState, map, world);

      // 9. Execute the gathered actions
      executeActions(world, actionList);

    } catch (error) {
      console.error('Error during game step:', error);
    }
  },

  onGameEnd: async () => {
    logger.logMessage('Game has ended', 1);
    gameState.reset();
  },

  onUnitDestroyed: async (world, unit) => {
    if (unit.isWorker()) {
      releaseWorkerFromBuilding(unit);
    }
  },

  onUnitFinished: async (world, unit) => {
    if (unit.isStructure() && unit.pos) {
      const workerTag = getWorkerReservedForPosition(unit.pos); // Use unit.pos instead of unit.tag
      if (workerTag) {
        const { units } = world.resources.get();
        const worker = units.getByTag(workerTag);
        if (worker) {
          releaseWorkerFromBuilding(worker);
        }
      }
    }
  },

  onUnitIdle: async (world, unit) => {
    if (unit.isWorker() && !unit.isConstructing()) {
      releaseWorkerFromBuilding(unit);
    }
  }
});

const engine = createEngine();

engine.connect().then(() => {
  return engine.runGame(config.defaultMap, [
    createPlayer({ race: config.defaultRace }, bot),
    createPlayer({ race: config.defaultRace, difficulty: config.defaultDifficulty }),
  ]);
}).catch(err => {
  logger.logError('Error in connecting to the engine or starting the game:', err);
});

module.exports = bot;