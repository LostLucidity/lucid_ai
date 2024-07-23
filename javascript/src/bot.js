"use strict";

// External library imports
const { createAgent, createEngine, createPlayer } = require('@node-sc2/core');
const { Upgrade } = require('@node-sc2/core/constants');
const { BUILD_ASSIMILATOR, EFFECT_CALLDOWNMULE } = require('@node-sc2/core/constants/ability');
const { Alliance } = require('@node-sc2/core/constants/enums');
const { ASSIMILATOR, PROBE, ORBITALCOMMAND } = require('@node-sc2/core/constants/unit-type');
const { performance } = require('perf_hooks');

const ActionCollector = require('./features/actions/actionCollector');
const { getDistance } = require('./features/shared/pathfinding/spatialCoreUtils');
const { findPlacements } = require('./features/shared/pathfinding/spatialUtils');
const StrategyManager = require('./features/strategy/strategyManager');
const { gather, balanceWorkerDistribution } = require('./gameLogic/economy/workerAssignment');
const { getWorkerAssignedToStructure, releaseWorkerFromBuilding } = require('./gameLogic/economy/workerService');
const { GameState } = require('./gameState');
const GameInitialization = require('./initialization/GameInitialization');
const { resetNoFreeGeysersLogFlag, lastLoggedUnitType, resetNoValidPositionLogFlag } = require('./utils/buildingUtils');
const cacheManager = require('./utils/cache');
const logger = require('./utils/logger');
const { clearAllPendingOrders } = require('./utils/unitUtils');
const { assignWorkers } = require('./utils/workerUtils');
const config = require('../config/config');
const { getBasicProductionUnits } = require('./units/management/basicUnitUtils');

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
 * Balance worker distribution across bases.
 * @param {World} world
 * @param {UnitResource} units
 * @param {ResourceManager} resources
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function balanceWorkers(world, units, resources, actionList) {
  actionList.push(...balanceWorkerDistribution(world, units, resources));
}

/**
 * Checks and updates the build order progress.
 * @param {World} world - The current game world state.
 * @param {import('./utils/globalTypes').BuildOrderStep[]} buildOrder - The build order to track and update.
 */
async function checkBuildOrderProgress(world, buildOrder) {
  const currentTimeInSeconds = world.resources.get().frame.timeInSeconds();
  const currentSupply = gameState.getFoodUsed();

  for (const [index, order] of buildOrder.entries()) {
    const orderStatus = buildOrderCompletion.get(order) || { completed: false, logged: false, prematureLogged: false };

    if (orderStatus.completed) continue;

    const satisfied = StrategyManager.getInstance().isStepSatisfied(world, order);
    const expectedTimeInSeconds = timeStringToSeconds(order.time);
    const timeDifference = currentTimeInSeconds - expectedTimeInSeconds;
    const supplyDifference = currentSupply - Number(order.supply);
    const timeStatus = timeDifference < 0 ? "ahead of schedule" : "behind schedule";

    if (satisfied && isStepInProgress(world, order)) {
      if (currentTimeInSeconds >= expectedTimeInSeconds - MARGIN_OF_ERROR_SECONDS) {
        orderStatus.completed = true;
        logBuildOrderStep(index, order, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, false, currentSupply);
      } else if (!orderStatus.prematureLogged) {
        logBuildOrderStep(index, order, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, true, currentSupply);
        orderStatus.prematureLogged = true;
      }
    } else if (currentTimeInSeconds >= expectedTimeInSeconds + BASE_BUFFER_TIME_SECONDS + ADDITIONAL_BUFFER_PER_ACTION_SECONDS && !orderStatus.logged) {
      console.warn(`Build Order Step ${index} NOT Completed: Supply-${order.supply} Time-${order.time} Action-${order.action}. Expected by time ${order.time}, current time is ${currentTimeInSeconds.toFixed(2)} seconds. Current Supply: ${currentSupply}. Time Difference: ${Math.abs(timeDifference).toFixed(2)} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`);
      orderStatus.logged = true;
    }

    buildOrderCompletion.set(order, orderStatus);
  }
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
 * Handle idle PROBES near warping ASSIMILATORS.
 * @param {UnitResource} units
 * @param {Array<Unit>} allUnits
 * @param {ResourceManager} resources
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList
 */
function handleIdleProbesNearWarpingAssimilators(units, allUnits, resources, actionList) {
  const assimilatorsWarpingIn = units.getByType(ASSIMILATOR).filter(assimilator => assimilator.buildProgress !== undefined && assimilator.buildProgress < 1);

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
 * Check if a step (construction, morph, or training) is in progress.
 * @param {World} world - The current game world state.
 * @param {import('./utils/globalTypes').BuildOrderStep} step - The build order step to check.
 * @returns {boolean} - True if the step is in progress, otherwise false.
 */
function isStepInProgress(world, step) {
  const { resources, data } = world;
  const { units } = resources.get();

  const unitTypes = (step.interpretedAction || [])
    .map(action => action.unitType)
    .filter(unitType => unitType !== null); // Filter out null values

  if (unitTypes.length === 0) return false;

  return unitTypes.some(unitType => {
    const unitData = data.getUnitTypeData(unitType);
    const abilityId = unitData?.abilityId;
    if (!abilityId) return false;

    return units.getAll(Alliance.SELF).some(unit => isUnitInProgress(world, unit, unitType, abilityId));
  });
}

/**
 * Check if a unit is in progress (construction, morph, or training).
 * @param {World} world - The current game world state.
 * @param {Unit} unit - The unit to check.
 * @param {number} unitType - The unit type to check.
 * @param {number} abilityId - The ability ID associated with the unit type.
 * @returns {boolean} - True if the unit is in progress, otherwise false.
 */
function isUnitInProgress(world, unit, unitType, abilityId) {
  // Check if the unit type is under construction or morphing
  if (unit.unitType === unitType && unit.buildProgress !== undefined && unit.buildProgress > 0 && unit.buildProgress < 1) {
    return true;
  }

  // Check if the unit is being trained or produced
  if (unit.orders) {
    return unit.orders.some(order => {
      if (order.abilityId !== abilityId) return false;

      // Ensure the order is from a production structure and in progress
      const productionUnits = getBasicProductionUnits(world, unitType);
      return productionUnits.some(productionUnit =>
        productionUnit.orders && productionUnit.orders.some(productionOrder =>
          productionOrder.abilityId === abilityId
        )
      );
    });
  }

  return false;
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
 * Logs build order step completion status.
 * @param {number} index - The index of the build order step.
 * @param {import('./utils/globalTypes').BuildOrderStep} order - The build order step.
 * @param {number} currentTimeInSeconds - The current game time in seconds.
 * @param {number} expectedTimeInSeconds - The expected time for the order in seconds.
 * @param {string} timeStatus - The time status (ahead/behind schedule).
 * @param {number} timeDifference - The time difference between current and expected time.
 * @param {number} supplyDifference - The supply difference between current and expected supply.
 * @param {boolean} premature - Whether the completion is premature.
 * @param {number} currentSupply - The current supply value.
 */
function logBuildOrderStep(index, order, currentTimeInSeconds, expectedTimeInSeconds, timeStatus, timeDifference, supplyDifference, premature, currentSupply) {
  const logMessage = premature
    ? `Build Order Step ${index} Prematurely Completed: Supply-${order.supply} Time-${order.time} Action-${order.action} at game time ${currentTimeInSeconds.toFixed(2)} seconds. Expected time: ${expectedTimeInSeconds.toFixed(2)} seconds. Current Supply: ${currentSupply}. Time Difference: ${Math.abs(timeDifference).toFixed(2)} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`
    : `Build Order Step ${index} Completed: Supply-${order.supply} Time-${order.time} Action-${order.action} at game time ${currentTimeInSeconds.toFixed(2)} seconds. Current Supply: ${currentSupply}. Time Difference: ${Math.abs(timeDifference).toFixed(2)} seconds ${timeStatus}. Supply Difference: ${supplyDifference}`;

  console.log(logMessage);
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
const actionResultStrings = Object.keys(ActionResult).reduce((/** @type {ActionResultStrings} */ acc, key) => {
  const numericKey = ActionResult[/** @type {keyof typeof ActionResult} */ (key)];
  acc[numericKey] = key;
  return acc;
}, {});

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
 * Update completed bases and cache them.
 * @param {UnitResource} units
 * @param {CacheManager} cacheManager
 */
function updateCompletedBases(units, cacheManager) {
  const newCompletedBases = units.getBases().filter(base => {
    const isCompleted = (base.buildProgress ?? 0) >= 1;
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

  /** @type {UpgradeProgress[]} */
  const upgradesInProgress = allUnits.reduce((/** @type {UpgradeProgress[]} */ acc, unit) => {
    if (unit.isStructure() && unit.orders && unit.orders.length > 0) {
      unit.orders.forEach(order => {
        const upgradeId = UPGRADE_ABILITY_IDS.get(order.abilityId);
        if (upgradeId !== undefined) {
          acc.push({ upgradeType: upgradeId, inProgress: true });
        }
      });
    }
    return acc;
  }, []);

  gameState.updateUpgradesInProgress(upgradesInProgress);
}

/**
 * Use ORBITALCOMMAND energy for calling down MULEs.
 * @param {World} world - The current game world state.
 * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} actionList - List of actions to be executed.
 */
function useOrbitalCommandEnergy(world, actionList) {
  const { units } = world.resources.get();
  const orbitalCommands = units.getByType(ORBITALCOMMAND);

  orbitalCommands.forEach(orbital => {
    const energy = orbital.energy;
    const tag = orbital.tag;
    if (energy !== undefined && energy >= 50 && tag) { // Check if energy and tag are defined and energy is >= 50
      const mineralFields = units.getMineralFields();
      if (mineralFields.length > 0) {
        const targetMineralField = mineralFields.reduce((maxField, field) =>
          (field.mineralContents !== undefined && (maxField.mineralContents === undefined || field.mineralContents > maxField.mineralContents) ? field : maxField), mineralFields[0]);

        actionList.push({
          abilityId: EFFECT_CALLDOWNMULE,
          targetUnitTag: targetMineralField.tag,
          unitTags: [tag]
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
      /** @type {Array<SC2APIProtocol.ActionRawUnitCommand>} */
      const actionList = [];
      const allUnits = units.getAll();

      // Update game state and build order progress before issuing commands
      updateCompletedBases(units, cacheManager);
      await checkBuildOrderProgress(world, gameState.getBuildOrder());

      // Gather resources efficiently and handle idle probes
      queueGatherOrdersForProbes(units, allUnits, resources, actionList);
      handleIdleProbesNearWarpingAssimilators(units, allUnits, resources, actionList);

      // Collect actions and handle upgrades
      collectActions(world, actionList);
      updateUpgradesInProgress(allUnits, world);

      // Track game metrics and log relevant information
      trackPerformance(frame, gameState);
      logGeyserActivity(map);
      logUnitPositions(world);

      // Balance workers and manage Orbital Command energy usage
      balanceWorkers(world, units, resources, actionList);
      assignMineralWorkers(resources, actionList);
      useOrbitalCommandEnergy(world, actionList);

      // Update game state and execute actions
      gameState.setFoodUsed(world);
      await executeActions(world, actionList);

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
    if (unit.isStructure() && typeof unit.tag === 'string') {
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
