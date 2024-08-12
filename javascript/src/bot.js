"use strict";

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Upgrade } = require('@node-sc2/core/constants');
const { BUILD_ASSIMILATOR, EFFECT_CALLDOWNMULE } = require('@node-sc2/core/constants/ability');
const { DisplayType } = require('@node-sc2/core/constants/enums');
const { ASSIMILATOR, PROBE, ORBITALCOMMAND } = require('@node-sc2/core/constants/unit-type');
const { performance } = require('perf_hooks');

const ActionCollector = require('./features/actions/actionCollector');
const { getDistance } = require('./features/shared/pathfinding/spatialCoreUtils');
const { findPlacements } = require('./features/shared/pathfinding/spatialUtils');
const { midGameTransition } = require('./features/strategy/midGameTransition');
const StrategyManager = require('./features/strategy/strategyManager');
const { startTrackingWorkerGathering, calculateGatheringTime } = require('./gameLogic/economy/gatheringManagement');
const { gather, balanceWorkers } = require('./gameLogic/economy/workerAssignment');
const { getWorkerAssignedToStructure, releaseWorkerFromBuilding } = require('./gameLogic/economy/workerService');
const GameInitialization = require('./initialization/GameInitialization');
const { GameState } = require('./state');
const buildOrderState = require('./state/buildOrderState');
const { resetNoFreeGeysersLogFlag, lastLoggedUnitType, resetNoValidPositionLogFlag } = require('./utils/buildingUtils');
const cacheManager = require('./utils/cache');
const logger = require('./utils/logger');
const { clearAllPendingOrders } = require('./utils/unitUtils');
const { assignWorkers } = require('./utils/workerUtils');
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
function assignMineralWorkers(resources, actionList) {
  actionList.push(...assignWorkers(resources));
}

/**
 * Checks and updates the build order progress.
 * @param {World} world - The current game world state.
 * @param {import('./utils/globalTypes').BuildOrderStep[]} buildOrder - The build order to track and update.
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
    } else if (isStepDelayed(currentTimeInSeconds, expectedTimeInSeconds, orderStatus)) {
      if (!orderStatus.logged) {
        logDelayedStep(
          order, index, currentTimeInSeconds, expectedTimeInSeconds,
          timeStatus, timeDifference, supplyDifference, currentSupply
        );
        orderStatus.logged = true;
      }
    }

    if (!orderStatus.completed) {
      allStepsCompleted = false;
    }

    buildOrderCompletion.set(order, orderStatus);
  });

  buildOrderState.setBuildOrderCompleted(allStepsCompleted);
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
 * Get the status of the order from the buildOrderCompletion map.
 * @param {import('./utils/globalTypes').BuildOrderStep} order
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
 * @param {import('./utils/globalTypes').BuildOrderStep} order
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
    logStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, false, currentSupply);
    return;
  }

  if (!orderStatus.prematureLogged) {
    logStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, true, currentSupply);
    orderStatus.prematureLogged = true;
  }
}

/**
 * Check if a step is delayed.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {{completed: boolean, logged: boolean, prematureLogged: boolean}} orderStatus
 * @returns {boolean} True if the step is delayed, otherwise false
 */
function isStepDelayed(currentTimeInSeconds, expectedTimeInSeconds, orderStatus) {
  return currentTimeInSeconds >= expectedTimeInSeconds + BASE_BUFFER_TIME_SECONDS + ADDITIONAL_BUFFER_PER_ACTION_SECONDS && !orderStatus.logged;
}

/**
 * Logs build order step completion status.
 * @param {import('./utils/globalTypes').BuildOrderStep} order - The build order step.
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds - The current game time in seconds.
 * @param {number} expectedTimeInSeconds - The expected time for the order in seconds.
 * @param {string} timeStatus - The time status (ahead/behind schedule).
 * @param {number} timeDifference - The time difference between current and expected time.
 * @param {number} supplyDifference - The supply difference between current and expected supply.
 * @param {boolean} premature - Whether the completion is premature.
 * @param {number} currentSupply - The current supply value.
 */
function logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, premature, currentSupply) {
  const { supply, time, action } = order;
  const formattedCurrentTime = currentTimeInSeconds.toFixed(2);
  const formattedExpectedTime = expectedTimeInSeconds.toFixed(2);
  const formattedTimeDifference = Math.abs(timeDifference).toFixed(2);

  const logMessage = `Build Order Step ${premature ? 'Prematurely ' : ''}Completed: Step-${index} Supply-${supply} Time-${time} Action-${action} at game time ${formattedCurrentTime} seconds. ${premature ? `Expected time: ${formattedExpectedTime} seconds. ` : ''}Current Supply: ${currentSupply}. Time Difference: ${formattedTimeDifference} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`;

  console.log(logMessage);
}


/**
 * Log a delayed build order step.
 * @param {import('./utils/globalTypes').BuildOrderStep} order
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {string} timeStatus
 * @param {number} timeDifference
 * @param {number} supplyDifference
 * @param {number} currentSupply
 */
function logDelayedStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, currentSupply) {
  console.warn(`Build Order Step NOT Completed: Step-${index} Supply-${order.supply} Time-${order.time} Action-${order.action}. Expected by time ${order.time}, current time is ${currentTimeInSeconds.toFixed(2)} seconds. Current Supply: ${currentSupply}. Time Difference: ${Math.abs(timeDifference).toFixed(2)} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`);
}

/**
 * Log the build order step.
 * @param {import('./utils/globalTypes').BuildOrderStep} order
 * @param {number} index - The index of the build order step.
 * @param {number} currentTimeInSeconds
 * @param {number} expectedTimeInSeconds
 * @param {string} timeStatus
 * @param {number} timeDifference
 * @param {number} supplyDifference
 * @param {boolean} isPremature
 * @param {number} currentSupply
 */
function logStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, isPremature, currentSupply) {
  logBuildOrderStep(order, index, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, isPremature, currentSupply);
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
  const candidatePositions = findPlacements(world, unitType);
  return candidatePositions.length;
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

      // Update game state and build order progress before issuing commands
      updateCompletedBases(units, cacheManager);
      checkBuildOrderProgress(world, gameState.getBuildOrder());

      // Track and calculate average gathering time
      updateAverageGatheringTime(workers, world);

      /**
       * @type {number[]} 
       */
      const gatheringTimes = [];
      let totalGatheringTime = 0;
      let gatherCount = 0;

      workers.forEach(worker => {
        startTrackingWorkerGathering(worker, world);
        const gatherTime = calculateGatheringTime(worker, world);
        if (gatherTime !== null) {
          gatheringTimes.push(gatherTime);
        }
      });

      if (gatheringTimes.length > 0) {
        // Calculate mean and standard deviation
        const mean = gatheringTimes.reduce((a, b) => a + b, 0) / gatheringTimes.length;
        const stdDev = Math.sqrt(gatheringTimes.map(time => Math.pow(time - mean, 2)).reduce((a, b) => a + b, 0) / gatheringTimes.length);

        // Filter out outliers based on standard deviation
        const filteredTimes = gatheringTimes.filter(time => Math.abs(time - mean) <= 2 * stdDev);

        // Calculate the average from the filtered times
        if (filteredTimes.length > 0) {
          filteredTimes.forEach(time => {
            totalGatheringTime += time;
            gatherCount++;
          });

          const calculatedAverage = totalGatheringTime / gatherCount;

          // Adjust the smoothing factor based on data variability
          const smoothingFactor = stdDev / (mean + stdDev); // The higher the stdDev, the lower the smoothing factor
          averageGatheringTime = (averageGatheringTime || calculatedAverage) * (1 - smoothingFactor) + calculatedAverage * smoothingFactor;
        }
      }

      // Only transition to mid-game if the build order is completed
      if (buildOrderState.isBuildOrderCompleted()) {
        midGameTransition(world, actionList);
      }

      // Handle idle probes and other worker management
      queueGatherOrdersForProbes(units, allUnits, resources, actionList);
      handleIdleProbesNearWarpingAssimilators(units, allUnits, resources, actionList);

      // Collect actions and handle upgrades
      collectActions(world, actionList);
      updateUpgradesInProgress(allUnits, world);

      // Track performance and log relevant information
      trackPerformance(frame, gameState);
      logGeyserActivity(map);
      logUnitPositions(world);

      // Balance workers and manage Orbital Command energy usage
      balanceWorkers(world, units, resources, actionList);
      assignMineralWorkers(resources, actionList);
      useOrbitalCommandEnergy(world, actionList);

      // Update game state and execute actions
      gameState.setFoodUsed(world);
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
    if (unit.isStructure() && unit.tag) {
      const workerTag = getWorkerAssignedToStructure(unit.tag);
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