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
const { canBuild, createUnitCommand } = require('../../core/common');
const { gasMineCheckAndBuild, getMineralFieldsNearby, getGasGeysersNearby } = require('../../features/construction/buildingService');
const { getPendingOrders } = require('../../services/sharedServices');
const { GameState } = require('../../state');
const { mine } = require('../../units/management/unitCommands');
const { unitTypeTrainingAbilities } = require('../../units/management/unitConfig');
const { getProductionUnits } = require('../../units/management/unitManagement');
const { calculateDistance } = require('../../utils/coreUtils');

// Precompute the gasMineConstructionAbilities Set once if it doesn't change frequently
const gasMineConstructionAbilities = new Set();

/**
 * Initializes the gas mine construction abilities set.
 */
function initializeGasMineConstructionAbilities() {
  gasMineConstructionAbilities.clear(); // Clear previous data if any
  unitTypeTrainingAbilities.forEach((unitType, abilityId) => {
    if (gasMineTypes.includes(unitType)) {
      gasMineConstructionAbilities.add(abilityId);
    }
  });
}

// Initialize gasMineConstructionAbilities at startup
initializeGasMineConstructionAbilities();

/**
 * Balances the resources based on the target ratio.
 * @param {World} world - The game world context.
 * @param {number} targetRatio - The target ratio of minerals to vespene gas.
 * @param {(world: World, unitType: number, targetCount?: number | undefined, candidatePositions?: Point2D[] | undefined) => SC2APIProtocol.ActionRawUnitCommand[]} buildFunction - The function to build the gas mine.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - The actions to balance resources.
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

  /** @type {SC2APIProtocol.ActionRawUnitCommand[]} */
  const actionsToReturn = [];

  /**
   * Checks if a base is oversaturated with workers.
   * @param {Unit} base - The base to check for oversaturation.
   * @returns {boolean} - True if the base is oversaturated, false otherwise.
   */
  const isBaseOversaturated = (base) => {
    const idealHarvesters = base.idealHarvesters || 0;
    const assignedHarvesters = base.assignedHarvesters || 0;
    return assignedHarvesters > idealHarvesters;
  };

  /**
   * Moves a worker to a gas mine.
   * @param {Unit} gasMine - The gas mine to move the worker to.
   * @param {Unit} townhall - The townhall to get the worker from.
   */
  const moveWorkerToGas = (gasMine, townhall) => {
    if (!townhall.pos) return;
    const gatheringMineralWorkers = getWorkersMiningMinerals(units).filter(worker => !isMule(worker));
    if (gatheringMineralWorkers.length > 0) {
      const [donatingWorker] = units.getClosest(townhall.pos, gatheringMineralWorkers);
      if (donatingWorker) {
        const action = mine(donatingWorker, gasMine, false);
        if (action) actionsToReturn.push(action);
      }
    }
  };

  /**
   * Moves a worker to mine minerals.
   * @param {Unit} base - The base needing more workers.
   * @param {Unit} gasMine - The gas mine to get the worker from.
   */
  const moveWorkerToMinerals = (base, gasMine) => {
    if (!gasMine.pos) return;
    const gatheringGasWorkers = getGatheringWorkers(units, "vespene").filter(worker => !isMining(units, worker) && !isMule(worker));
    if (gatheringGasWorkers.length > 0) {
      const [donatingWorker] = units.getClosest(gasMine.pos, gatheringGasWorkers);
      if (donatingWorker) {
        actionsToReturn.push(...gather(resources, donatingWorker, null, false));
      }
    }
  };

  const balanceWorkers = () => {
    if (mineralMinerCountRatio > targetRatio) {
      const decreaseRatio = (mineralMinerCount - 1) / (vespeneMinerCount + 1);
      if ((mineralMinerCountRatio + decreaseRatio) / 2 >= targetRatio) {
        if (needyGasMines.length > 0) {
          const needyGasMine = getRandom(needyGasMines);
          const townhalls = units.getBases(readySelfFilter);
          if (needyGasMine.pos) {
            const [givingTownhall] = units.getClosest(needyGasMine.pos, townhalls);
            if (!isBaseOversaturated(needyGasMine) && givingTownhall?.pos) {
              moveWorkerToGas(needyGasMine, givingTownhall);
            }
          }
        }
      } else {
        gasMineCheckAndBuild(world, targetRatio, buildFunction);
      }
    } else if (mineralMinerCountRatio < targetRatio) {
      const increaseRatio = (mineralMinerCount + 1) / (vespeneMinerCount - 1);
      if ((mineralMinerCountRatio + increaseRatio) / 2 <= targetRatio) {
        const needyBase = units.getBases(readySelfFilter).find(base => {
          const { assignedHarvesters, idealHarvesters, pos } = base;
          return assignedHarvesters !== undefined && idealHarvesters !== undefined && assignedHarvesters < idealHarvesters && pos !== undefined;
        });
        if (needyBase && !isBaseOversaturated(needyBase)) {
          const gasMines = units.getAlive(readySelfFilter).filter(u => u.isGasMine());
          if (needyBase.pos) {
            const [givingGasMine] = units.getClosest(needyBase.pos, gasMines);
            if (givingGasMine && givingGasMine.pos) {
              moveWorkerToMinerals(needyBase, givingGasMine);
            }
          }
        }
      }
    }
  };

  balanceWorkers();

  const oversaturatedMineralBases = units.getBases(readySelfFilter).filter(isBaseOversaturated);
  const oversaturatedGasMines = units.getAlive(readySelfFilter).filter(unit => unit.isGasMine() && isBaseOversaturated(unit));

  oversaturatedMineralBases.forEach(base => {
    if (needyGasMines.length > 0) {
      const needyGasMine = getRandom(needyGasMines);
      if (base.pos) moveWorkerToGas(needyGasMine, base);
    }
  });

  oversaturatedGasMines.forEach(gasMine => {
    const needyBase = units.getBases(readySelfFilter).find(base => {
      const { assignedHarvesters, idealHarvesters, pos } = base;
      return assignedHarvesters !== undefined && idealHarvesters !== undefined && assignedHarvesters < idealHarvesters && pos !== undefined;
    });
    if (gasMine.pos && needyBase) moveWorkerToMinerals(needyBase, gasMine);
  });

  return actionsToReturn;
};

/**
 * Calculate the number of workers that can be supported by the gas mines near a given base.
 * @param {UnitResource} units 
 * @param {Unit} base 
 * @returns {number}
 */
function calculateGasWorkerCapacity(units, base) {
  if (!base.pos) return 0;  // Ensure base.pos is defined

  const gasGeysers = getGasGeysersNearby(units, base.pos);
  return gasGeysers.reduce((gasWorkerCapacity, gasGeyser) => {
    if (!gasGeyser.pos) return gasWorkerCapacity;  // Ensure gasGeyser.pos is defined

    const gasMines = units.getGasMines().filter(gasMine => {
      // Ensure both gasMine.pos and gasGeyser.pos are defined before calculating distance
      if (!gasMine.pos || !gasGeyser.pos) return false;
      const distance = calculateDistance(gasGeyser.pos, gasMine.pos);
      const isGasMineBuilt = gasMine.buildProgress !== undefined && gasMine.buildProgress > 0;
      return distance <= 1 && gasMine.alliance === Alliance.SELF && isGasMineBuilt;
    });

    const gasStructure = gasMines.length > 0 ? gasMines[0] : null;
    // Safely use buildProgress with a default of 0 if undefined
    const gasBuildProgress = gasStructure ? (gasStructure.buildProgress || 0) : 0;
    return gasWorkerCapacity + (gasBuildProgress * 3);
  }, 0);
}

/**
 * Calculates the maximum number of workers based on current game conditions.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {number} - The calculated maximum number of workers.
 */
function calculateMaxWorkers(units) {
  const bases = units.getBases();
  return bases.reduce((totalMaxWorkers, base) => {
    // Check if base.pos is defined and base.buildProgress is greater than 0
    // Defaulting base.buildProgress to 0 if it's undefined
    const baseBuildProgress = base.buildProgress || 0;
    if (!base.pos || baseBuildProgress <= 0) return totalMaxWorkers;

    const mineralWorkerCapacity = calculateMineralWorkerCapacity(units, base);
    const gasWorkerCapacity = calculateGasWorkerCapacity(units, base);
    return totalMaxWorkers + mineralWorkerCapacity + gasWorkerCapacity;
  }, 0);
}

/**
 * Calculate the number of workers that can be supported by the mineral fields near a given base.
 * @param {UnitResource} units 
 * @param {Unit} base 
 * @returns {number}
 */
function calculateMineralWorkerCapacity(units, base) {
  // Check if base.pos is defined before attempting to use it
  if (!base.pos) return 0;  // Return 0 as no workers can be supported without a position

  const mineralFields = getMineralFieldsNearby(units, base.pos);
  // Safely use buildProgress, defaulting to 0 if undefined
  const buildProgress = base.buildProgress || 0;
  return buildProgress * (mineralFields.length * 2);
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
 * Checks if a unit is a MULE.
 * @param {Unit} unit - The unit to check.
 * @returns {boolean} - True if the unit is a MULE, false otherwise.
 */
const isMule = (unit) => {
  return unit.unitType === UnitType.MULE;
};

/**
 * Retrieves the count of workers mining minerals and vespene, including MULEs.
 * @param {UnitResource} units
 * @returns {{ mineralMinerCount: number, vespeneMinerCount: number, muleCount: number }}
 */
function getMinerCount(units) {
  const readySelfFilter = { buildProgress: 1, alliance: Alliance.SELF };

  /**
   * Helper function to count assigned harvesters for a given unit type.
   * @param {Array<{ assignedHarvesters?: number }>} unitArray - Array of unit objects.
   * @returns {number}
   */
  function countAssignedHarvesters(unitArray) {
    return unitArray.reduce((accumulator, unit) => {
      return accumulator + (unit.assignedHarvesters || 0);
    }, 0);
  }

  const mineralMinerCount = countAssignedHarvesters(units.getBases(readySelfFilter));

  const muleCount = units.getById(UnitType.MULE).filter(mule => mule.isHarvesting()).length;
  const adjustedMineralMinerCount = mineralMinerCount + (muleCount * 2.72); // Use precise mining rate for MULEs

  const vespeneMinerCount = countAssignedHarvesters(units.getGasMines(readySelfFilter));

  return { mineralMinerCount: adjustedMineralMinerCount, vespeneMinerCount, muleCount };
}

/**
 * Gets workers that are currently mining minerals.
 * @param {UnitResource} units - The units resource object from the bot.
 * @returns {Unit[]} - The list of workers mining minerals.
 */
function getWorkersMiningMinerals(units) {
  return units.getWorkers().filter(unit =>
    unit.orders && unit.orders.some(order => {
      const abilityId = order.abilityId;
      if (!order.targetUnitTag) return false;
      const targetUnit = units.getByTag(order.targetUnitTag);
      return (
        abilityId !== undefined &&
        [...gatheringAbilities].includes(abilityId) &&
        targetUnit &&
        targetUnit.unitType !== undefined &&
        mineralFieldTypes.includes(targetUnit.unitType)
      );
    })
  );
}

/**
 * Gets gas mines that need additional workers, including consideration for those under construction.
 * @param {UnitResource} units The units resource object from the bot.
 * @returns {Unit[]} List of gas mines that need more workers.
 */
function getNeedyGasMines(units) {
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
  const pendingFoodUsed = race === Race.ZERG ? GameState.getWorkers(world).filter(worker => worker.isConstructing()).length : 0;

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
  initializeGasMineConstructionAbilities,
  setFoodUsed,
  trainAdditionalWorkers,
  trainWorker,
  shouldTrainMoreWorkers,
};
