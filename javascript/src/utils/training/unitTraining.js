// Import necessary dependencies and constants from other modules or core constants
const { UnitType } = require("@node-sc2/core/constants");
const { Race, Attribute } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { train } = require("./trainingUtils");
const { setPendingOrders } = require("./unitOrders");
const { haveAvailableProductionUnitsFor, getAffordableFoodDifference } = require("./unitUtils");
const GameState = require("../../core/gameState");
const StrategyManager = require("../../features/strategy/strategyManager");
const { getPendingOrders } = require("../../gameLogic/stateManagement");
const { createUnitCommand } = require("../common/utils");
const { getEarmarkedFood, addEarmark } = require("../construction/resourceUtils");
const { getById } = require("../misc/gameUtils");
const { shortOnWorkers } = require("../worker/workerUtils");

/**
 * @param {World} world
 * @param {number} unitType
 */
function checkProductionAvailability(world, unitType) {
  const gameState = GameState.getInstance();
  if (gameState.availableProductionUnits.has(unitType)) {
    return gameState.availableProductionUnits.get(unitType) || false;
  }
  const haveAvailableProductionUnits = haveAvailableProductionUnitsFor(world, unitType);
  gameState.availableProductionUnits.set(unitType, haveAvailableProductionUnits);
  return haveAvailableProductionUnits;
}

/**
 * Earmarks workers for future training based on available food capacity.
 * @param {World} world The game world context.
 * @param {number} foodAvailable The amount of food capacity available for training workers.
 */
function earmarkWorkersForTraining(world, foodAvailable) {
  if (world.agent.race !== undefined) {
    const workerUnitTypeData = world.data.getUnitTypeData(WorkerRace[world.agent.race]);
    for (let i = 0; i < foodAvailable; i++) {
      addEarmark(world.data, workerUnitTypeData);
    }
  }
}

/**
 * Filters candidate unit types for training based on current strategy and game state.
 * @param {World} world The game world context.
 * @param {StrategyManager} strategyManager The current strategy manager.
 * @returns {UnitTypeId[]} An array of unit types that are candidates for training.
 */
function filterCandidateTypes(world, strategyManager) {
  const { data } = world;
  const gameState = GameState.getInstance();
  const currentStrategy = strategyManager.getCurrentStrategy();

  if (!currentStrategy || !currentStrategy.steps) {
    console.error('No current strategy or strategy steps defined.');
    return [];
  }

  const currentStepIndex = strategyManager.getCurrentStep();
  const currentPlanStep = currentStrategy.steps[currentStepIndex];

  const trainingTypes = strategyManager.getTrainingTypes();
  if (!trainingTypes) {
    console.error('Training types are undefined.');
    return [];
  }

  return trainingTypes.filter(type => {
    const unitTypeData = data.getUnitTypeData(type);
    const attributes = unitTypeData.attributes || [];
    const foodRequired = unitTypeData.foodRequired || 0;
    const supply = currentPlanStep ? parseInt(currentPlanStep.supply, 10) : 0;

    const isPlannedType = currentStrategy.steps.some(step => {
      const interpretedActions = Array.isArray(step.interpretedAction) ? step.interpretedAction : [step.interpretedAction];
      return interpretedActions.some(action => action && action.unitType === type);
    });

    return isPlannedType &&
      (!attributes.includes(Attribute.STRUCTURE)) &&
      foodRequired <= supply - gameState.getFoodUsed() &&
      gameState.checkTechFor(world.agent, type) &&
      checkProductionAvailability(world, type);
  });
}

/**
 * Optimizes the training of units based on the current game state and strategic needs.
 * @param {World} world The game world context.
 * @param {import("../../features/strategy/strategyService").PlanStep} step The current strategy step.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of unit training commands.
 */
function handleUnitTraining(world, step) {
  if (!world.agent.race || !step.unitType) return [];

  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed() + getEarmarkedFood();
  const foodAvailable = (step.food || 0) - foodUsed;
  if (foodAvailable <= 0) return [];

  let trainingOrders = shouldTrainWorkers(world) ? trainWorkers(world) : [];

  // Proceed to train combat units if no worker training orders are created
  if (trainingOrders.length === 0) {
    trainingOrders = trainCombatUnits(world);
  }

  // Earmark workers for future training if no training orders were created
  if (trainingOrders.length === 0 && WorkerRace[world.agent.race]) {
    earmarkWorkersForTraining(world, foodAvailable);
  }

  return trainingOrders;
}

/**
 * Selects a unit type to build from the list of candidate types.
 * @param {World} world The game world context.
 * @param {StrategyManager} strategyManager The current strategy manager.
 * @param {UnitTypeId[]} candidateTypes The candidate unit types for training.
 * @returns {UnitTypeId | null} The selected unit type to build, or null if none is selected.
 */
function selectUnitTypeToBuild(world, strategyManager, candidateTypes) {
  return strategyManager.selectTypeToBuild(world, candidateTypes);
}

// Unit training specific functions and data structures
/**
 * Analyzes the game state and decides if workers should be trained.
 * @param {World} world - The current game world context.
 * @returns {boolean} - True if conditions are met for training workers, false otherwise.
 */
function shouldTrainWorkers(world) {
  const { agent, resources } = world;

  if (agent.race === undefined || !agent.canAfford(WorkerRace[agent.race])) {
    return false;
  }

  const workerCount = getById(resources, [WorkerRace[agent.race]]).length;
  const bases = resources.get().units.getBases();
  const gasMines = resources.get().units.getGasMines();
  const assignedWorkerCount = [...bases, ...gasMines].reduce((acc, unit) => acc + (unit.assignedHarvesters || 0), 0);
  const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);
  const sufficientMinerals = typeof agent.minerals === 'number' && (agent.minerals < 512 || minimumWorkerCount <= 36);
  const productionPossible = haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]);
  const strategyManager = StrategyManager.getInstance();
  const notOutpowered = !strategyManager.getOutpowered();

  return sufficientMinerals && (shortOnWorkers(world) || getAffordableFoodDifference(world) > 0) && notOutpowered && productionPossible;
}

/**
 * Trains combat units based on the current strategy and game state.
 * @param {World} world The game world context.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function trainCombatUnits(world) {
  const { agent } = world;
  if (!agent.minerals || !agent.vespene) return [];

  const strategyManager = StrategyManager.getInstance();
  if (!strategyManager.getCurrentStrategy()) {
    console.error('Current strategy is undefined.');
    return [];
  }

  const candidateTypesToBuild = filterCandidateTypes(world, strategyManager);
  if (candidateTypesToBuild.length === 0) return [];

  const selectedType = selectUnitTypeToBuild(world, strategyManager, candidateTypesToBuild);
  if (!selectedType) return [];

  return strategyManager.getOutpowered() || agent.canAfford(selectedType) ? train(world, selectedType) : [];
}

/**
 * Train workers for all races, considering the unique Zerg training mechanism and ability availability.
 * @param {World} world - The game world context, containing all necessary game state information.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to be sent to the game.
 */
function trainWorkers(world) {
  const { agent, data, resources } = world;
  const { minerals, race } = agent;

  if (minerals === undefined || race === undefined) return [];

  const workerTypeId = WorkerRace[race]; // Assuming WorkerRace is a predefined mapping
  const workerTypeData = data.getUnitTypeData(workerTypeId);
  const { abilityId } = workerTypeData;

  if (!abilityId) return [];

  const collectedActions = [];

  if (race === Race.ZERG) {
    const larvae = resources.get().units.getById(UnitType.LARVA);
    for (const larva of larvae) {
      const pendingOrders = getPendingOrders(larva);
      const isAlreadyTraining = pendingOrders.some(order => order.abilityId === abilityId);

      if (larva.isIdle() && larva.abilityAvailable(abilityId) && !isAlreadyTraining) {
        const unitCommand = createUnitCommand(abilityId, [larva]);
        collectedActions.push(unitCommand);
        setPendingOrders(larva, unitCommand); // Update local state to reflect new order
        break; // Only issue one command per function call to manage resources efficiently
      }
    }
  } else {
    const bases = resources.get().units.getBases();
    for (const base of bases) {
      const pendingOrders = getPendingOrders(base);
      const isAlreadyTraining = pendingOrders.some(order => order.abilityId === abilityId);

      if (base.isIdle() && base.isFinished() && base.abilityAvailable(abilityId) && !isAlreadyTraining) {
        const unitCommand = createUnitCommand(abilityId, [base]);
        collectedActions.push(unitCommand);
        setPendingOrders(base, unitCommand); // Update local state to reflect new order
        break; // Issue command to the first eligible base only
      }
    }
  }

  return collectedActions;
}

module.exports = {
  shouldTrainWorkers,
  trainWorkers,
  trainCombatUnits,
  handleUnitTraining
};
