//@ts-check
"use strict"

// economyManagement.js

// External library imports
const { UnitType } = require('@node-sc2/core/constants');
const { Alliance, Race } = require('@node-sc2/core/constants/enums');
const { gatheringAbilities, mineralFieldTypes, vespeneGeyserTypes, gasMineTypes } = require('@node-sc2/core/constants/groups');
const { WorkerRace } = require('@node-sc2/core/constants/race-map');
const getRandom = require('@node-sc2/core/utils/get-random');

const { getGatheringWorkers, gather } = require('./workerAssignment');
const { isMining } = require('./workerService');
const { GameState } = require('../../core/gameState');
const { gasMineCheckAndBuild, getMineralFieldsNearby, getGasGeysersNearby } = require('../../features/construction/buildingService');
const { calculateDistance } = require('../../gameLogic/coreUtils');
const { getPendingOrders } = require('../../sharedServices');
const { canBuild, createUnitCommand } = require('../common/common');
const { mine } = require('../unit/unitCommands');
const { getProductionUnits } = require('../unit/unitManagement');
const { unitTypeTrainingAbilities } = require('../unitManagement/unitConfig');

/**
 * Balances the resources based on the target ratio.
 * @param {World} world - The game world context.
 * @param {number} targetRatio - The target ratio of minerals to vespene gas.
 * @param {(world: World, unitType: number, targetCount?: number | undefined, candidatePositions?: Point2D[] | undefined) => SC2APIProtocol.ActionRawUnitCommand[]} buildFunction - The function to build the gas mine.
 */
const balanceResources = (world, targetRatio = 16 / 6, buildFunction) => {
  const { agent, resources } = world;
  const { minerals, vespene } = agent;
  if (minerals === undefined || vespene === undefined) return [];
  const { units } = resources.get();
  targetRatio = isNaN(targetRatio) ? 16 / 6 : targetRatio;
  const maxRatio = 32 / 6;
  const increaseRatio = targetRatio > maxRatio || (vespene > 512 && minerals < 512);
  targetRatio = increaseRatio ? maxRatio : targetRatio;
  const needyGasMines = getNeedyGasMines(units);
  const { mineralMinerCount, vespeneMinerCount } = getMinerCount(units);
  const mineralMinerCountRatio = mineralMinerCount / vespeneMinerCount;
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  const needyBase = units.getBases(readySelfFilter).find(base => {
    const { assignedHarvesters, idealHarvesters } = base;
    if (assignedHarvesters === undefined || idealHarvesters === undefined) return false;
    return assignedHarvesters < idealHarvesters;
  });

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actionsToReturn = []; // Array to store actions

  if (mineralMinerCountRatio > targetRatio) {
    const decreaseRatio = (mineralMinerCount - 1) / (vespeneMinerCount + 1);
    if ((mineralMinerCountRatio + decreaseRatio) / 2 >= targetRatio) {
      if (needyGasMines.length > 0) {
        const townhalls = units.getBases(readySelfFilter);
        const needyGasMine = getRandom(needyGasMines);
        const { pos } = needyGasMine;
        if (pos === undefined) return [];
        const [givingTownhall] = units.getClosest(pos, townhalls);
        const gatheringMineralWorkers = units.getWorkers()
          .filter(unit => unit.orders && unit.orders.some(order => {
            const abilityId = order.abilityId; // Extract abilityId from order
            if (!order.targetUnitTag) return false; // Check if targetUnitTag is defined
            const targetUnit = units.getByTag(order.targetUnitTag); // Get the target unit
            return (
              abilityId !== undefined && // Check if abilityId is defined
              [...gatheringAbilities].includes(abilityId) &&
              targetUnit && // Check if targetUnit is defined
              targetUnit.unitType !== undefined && // Check if unitType is defined
              mineralFieldTypes.includes(targetUnit.unitType) // Use targetUnit.unitType
            );
          }));
        if (givingTownhall && givingTownhall.pos && gatheringMineralWorkers.length > 0) {
          const [donatingWorker] = units.getClosest(givingTownhall.pos, gatheringMineralWorkers);
          // Push the single action returned by mine() to actionsToReturn
          const action = mine(donatingWorker, needyGasMine, false);
          if (action) {
            actionsToReturn.push(action);
          }
        }
      }
    } else {
      gasMineCheckAndBuild(world, targetRatio, buildFunction);
    }
  } else if (mineralMinerCountRatio === targetRatio) {
    return actionsToReturn;
  } else if (needyBase && mineralMinerCountRatio < targetRatio) {
    const { pos: basePos } = needyBase;
    if (basePos === undefined) return [];
    const increaseRatio = (mineralMinerCount + 1) / (vespeneMinerCount - 1);

    if ((mineralMinerCountRatio + increaseRatio) / 2 <= targetRatio) {
      const gasMines = units.getAlive(readySelfFilter).filter(u => u.isGasMine());
      const [givingGasMine] = units.getClosest(basePos, gasMines);
      const gatheringGasWorkers = getGatheringWorkers(units, "vespene").filter(worker => !isMining(units, worker));

      if (givingGasMine && givingGasMine.pos && gatheringGasWorkers.length > 0) {
        const [donatingWorker] = units.getClosest(givingGasMine.pos, gatheringGasWorkers);
        // Concatenate the array returned by gather() with actionsToReturn
        actionsToReturn.push(...gather(resources, donatingWorker, null, false));
      }
    }
  }
  return actionsToReturn;
};

/**
 * Calculates the maximum number of workers based on current game conditions, 
 * considering the build progress of the townhalls and gas structures.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {number} - The calculated maximum number of workers.
 */
function calculateMaxWorkers(units) {
  const bases = units.getBases();
  let totalMaxWorkers = 0;
  const playerAlliance = Alliance.SELF;

  bases.forEach(base => {
    const baseBuildProgress = base.buildProgress || 0;
    if (!base.pos) return;

    const mineralFields = getMineralFieldsNearby(units, base.pos);
    const gasGeysers = getGasGeysersNearby(units, base.pos);

    let gasWorkerCapacity = 0;
    gasGeysers.forEach(gasGeyser => {
      if (!gasGeyser.pos) return;

      const gasMines = units.getGasMines().filter(gasMine =>
        gasMine.pos && gasGeyser.pos && calculateDistance(gasGeyser.pos, gasMine.pos) <= 1 &&
        gasMine.alliance === playerAlliance
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
 * 
 * @param {UnitResource} units 
 * @returns {any}
 */
function getMinerCount(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  let mineralMinerCount = units.getBases(readySelfFilter).reduce((accumulator, currentValue) => {
    return accumulator + (currentValue.assignedHarvesters || 0); // Check if assignedHarvesters is defined
  }, 0);
  mineralMinerCount += (units.getById(UnitType.MULE).filter(mule => mule.isHarvesting()).length * (3 + 2 / 3));
  const vespeneMinerCount = units.getGasMines(readySelfFilter).reduce((accumulator, currentValue) => {
    return accumulator + (currentValue.assignedHarvesters || 0); // Check if assignedHarvesters is defined
  }, 0);
  return { mineralMinerCount, vespeneMinerCount }
}

/**
 * Gets gas mines that need additional workers, including consideration for those under construction.
 * @param {UnitResource} units The units resource object from the bot.
 * @returns {Unit[]} List of gas mines that need more workers.
 */
function getNeedyGasMines(units) {
  // Set of ability IDs for constructing gas mines on geysers
  const gasMineConstructionAbilities = new Set();
  unitTypeTrainingAbilities.forEach((unitType, abilityId) => {
    if (gasMineTypes.includes(unitType)) {
      gasMineConstructionAbilities.add(abilityId);
    }
  });

  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };
  const gasMines = units.getGasMines(readySelfFilter);

  return gasMines.filter(gasMine => {
    const { assignedHarvesters, idealHarvesters } = gasMine;
    if (assignedHarvesters === undefined || idealHarvesters === undefined) return false;

    const constructingWorkers = units.getWorkers().filter(worker => {
      const currentOrders = worker.orders || [];
      const allOrders = currentOrders.concat(getPendingOrders(worker));

      return allOrders.some(order => {
        const abilityId = order.abilityId;
        const targetUnitTag = order.targetUnitTag;
        if (abilityId === undefined || targetUnitTag === undefined) return false;
        const targetUnit = units.getByTag(targetUnitTag);
        if (targetUnit === undefined) return false;

        const isTargetGeyser = targetUnit.unitType !== undefined && vespeneGeyserTypes.includes(targetUnit.unitType);
        const isConstructingGasMine = gasMineConstructionAbilities.has(abilityId);

        return isTargetGeyser && isConstructingGasMine;
      });
    });

    // Include workers that are likely to transition from building to harvesting
    const workersTransitioningToHarvest = constructingWorkers.filter(worker => {
      const currentOrders = worker.orders || [];
      const allOrders = currentOrders.concat(getPendingOrders(worker));
      return allOrders.some(order => {
        if (order.abilityId !== undefined && gasMine.unitType !== undefined) {
          const mappedUnitType = unitTypeTrainingAbilities.get(order.abilityId);
          return mappedUnitType !== undefined && gasMine.unitType === mappedUnitType;
        }
        return false;
      });
    }).length;

    const totalAssigned = assignedHarvesters + workersTransitioningToHarvest;
    return totalAssigned < idealHarvesters;
  });
}

/**
 * Update the food used based on the world state.
 * @param {World} world - The current world state.
 */
function setFoodUsed(world) {
  const { agent } = world;
  const { foodUsed, race } = agent;

  // Check if foodUsed is defined on the agent
  if (foodUsed === undefined) {
    console.error('Agent foodUsed is undefined');
    return;
  }

  // Get the singleton instance of GameState
  const gameState = GameState.getInstance();

  // Calculate pending food used, specific to Zerg race
  const pendingFoodUsed = race === Race.ZERG ? gameState.getWorkers(world).filter(worker => worker.isConstructing()).length : 0;

  // Calculate the total food used
  const calculatedFoodUsed = foodUsed + gameState.pendingFood - pendingFoodUsed;

  // Update the food used in the GameState
  gameState.resources.foodUsed = calculatedFoodUsed;
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
      if (agent.race !== undefined) {
        const workerType = WorkerRace[agent.race];
        if (workerType) {
          actions.push(...trainWorker(world, workerType));
        }
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

/**
 * Trains a worker at the specified base.
 * @param {World} world - The game world context.
 * @param {number} limit - The maximum number of workers to train.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The list of actions to train workers.
 */
function trainWorker(world, limit = 1) {
  const { agent, data } = world;

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const collectedActions = [];

  if (agent.race === undefined) {
    console.error("Agent race is undefined in trainWorker.");
    return collectedActions;
  }

  const workerTypeId = WorkerRace[agent.race];

  if (canBuild(world, workerTypeId)) {
    const { abilityId, foodRequired } = data.getUnitTypeData(workerTypeId);
    if (abilityId === undefined || foodRequired === undefined) return collectedActions;

    let trainers = getProductionUnits(world, workerTypeId);
    trainers = trainers.slice(0, limit);
    trainers.forEach(trainer => {
      const unitCommand = createUnitCommand(abilityId, [trainer]);
      collectedActions.push(unitCommand);
    });
  }

  return collectedActions;
}

module.exports = {
  balanceResources,
  calculateMaxWorkers,
  setFoodUsed,
  trainAdditionalWorkers,
  trainWorker,
  shouldTrainMoreWorkers,
};
