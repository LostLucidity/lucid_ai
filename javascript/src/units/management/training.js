const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { getBasicProductionUnits } = require("./basicUnitUtils");
const { createTrainingCommands } = require("./trainingCommands");
const { canTrainUnit, earmarkResourcesIfNeeded } = require("./trainingUtils");
const { unitTypeTrainingAbilities, flyingTypesMapping } = require("./unitConfig");
const { setPendingOrders } = require("./unitOrders");
const { haveAvailableProductionUnitsFor, getAffordableFoodDifference } = require("./unitUtils");
const { EarmarkManager } = require("../../core");
const { getUnitTypeData } = require("../../core/data/gameData");
const { findKeysForValue, createUnitCommand, findUnitTypesWithAbilityCached } = require("../../core/utils/common");
const StrategyContext = require("../../features/strategy/strategyContext");
const { selectUnitTypeToBuild } = require("../../features/strategy/unitSelection");
const { getBuildTimeLeft, shortOnWorkers } = require("../../gameLogic/economy/workerService");
const { filterSafeTrainers } = require("../../gameLogic/gameMechanics/strategyUtils");
const { getById } = require("../../gameLogic/shared/generalUtils");
const { GameState } = require('../../gameState');
const { getPendingOrders } = require("../../sharedServices");

/**
 * Earmarks workers for future training based on available food capacity.
 * @param {World} world The game world context.
 * @param {number} foodAvailable The amount of food capacity available for training workers.
 */
function earmarkWorkersForTraining(world, foodAvailable) {
  if (world.agent.race !== undefined) {
    const workerUnitTypeData = world.data.getUnitTypeData(WorkerRace[world.agent.race]);
    for (let i = 0; i < foodAvailable; i++) {
      EarmarkManager.getInstance().addEarmark(world.data, workerUnitTypeData);
    }
  }
}

/**
 * Filters candidate unit types for training based on current strategy and game state.
 * @param {World} world The game world context.
 * @returns {UnitTypeId[]} An array of unit types that are candidates for training.
 */
function filterCandidateTypes(world) {
  const { data } = world;
  const gameState = GameState.getInstance();
  const strategyContext = StrategyContext.getInstance();
  const currentStrategy = strategyContext.getCurrentStrategy();

  if (!currentStrategy || !currentStrategy.steps) {
    console.error('No current strategy or strategy steps defined.');
    return [];
  }

  const currentStepIndex = strategyContext.getCurrentStep();
  const currentPlanStep = currentStrategy.steps[currentStepIndex];

  const trainingTypes = strategyContext.getTrainingTypes();
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
      gameState.checkProductionAvailability(type);
  });
}

/**
 * Gets trainers that can produce a specific unit type, including those nearly finished training other units.
 * 
 * @param {World} world - The game world context.
 * @param {UnitTypeId} unitTypeId - The type ID of the unit to train.
 * @param {number} threshold - The time in frames or seconds until the next call (dynamic threshold).
 * @returns {Unit[]} Array of units that can train the specified unit type.
 */
function getTrainer(world, unitTypeId, threshold) {
  const { WARPGATE } = UnitType;
  const { data, resources } = world;
  const abilityId = data.getUnitTypeData(unitTypeId)?.abilityId;

  // Ensure abilityId is defined before proceeding
  if (abilityId === undefined) return [];

  const warpgateAbilityId = WarpUnitAbility[unitTypeId];
  const unitTypesWithAbility = findUnitTypesWithAbilityCached(data, abilityId);

  const units = resources.get().units;

  const canTrain = (/** @type {Unit} */ unit) => {
    if (!unit.buildProgress || unit.buildProgress < 1 || unit.labels.has('reposition')) {
      return false;
    }

    const currentAbilityId = unit.unitType === WARPGATE ? warpgateAbilityId : abilityId;
    const orders = unit.orders || [];
    const pendingOrders = getPendingOrders(unit);

    if ((orders.length + pendingOrders.length) === 0) return true;
    if (orders.length === 0 || orders[0].abilityId !== currentAbilityId) return false;

    const firstOrder = orders[0];
    if (firstOrder.abilityId === undefined) return false; // Ensure abilityId is defined

    const unitTypeTraining = unitTypeTrainingAbilities.get(firstOrder.abilityId);
    if (!unitTypeTraining) return false;

    const unitTypeData = data.getUnitTypeData(unitTypeTraining);
    if (!unitTypeData || unitTypeData.buildTime === undefined) return false;

    const buildTimeLeft = getBuildTimeLeft(unit, unitTypeData.buildTime, firstOrder.progress || 0);
    return buildTimeLeft <= threshold && pendingOrders.length === 0;
  };

  const productionUnits = getBasicProductionUnits(world, unitTypeId).filter(canTrain);
  const warpgateUnits = units.getById(WARPGATE).filter(canTrain);

  // Handle flying units if applicable
  const flyingTypes = unitTypesWithAbility.flatMap(type => findKeysForValue(flyingTypesMapping, type));
  const flyingUnits = units.getById(flyingTypes).filter(canTrain);

  return [...new Set([...productionUnits, ...warpgateUnits, ...flyingUnits])]; // Remove duplicates
}

/**
 * Handles the actions for training units, considering available trainers and safety.
 * Dynamically calculates the threshold for training actions based on game update frequency.
 * 
 * @param {World} world - The game world context.
 * @param {number} unitTypeId - The type ID of the unit to train.
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData - The data for the unit type being trained.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of commands to train units.
 */
function handleTrainingActions(world, unitTypeId, unitTypeData) {
  const gameState = GameState.getInstance();
  const framesPerStep = gameState.calculateFramesPerStep(world);

  const trainers = getTrainer(world, unitTypeId, framesPerStep);
  const safeTrainers = filterSafeTrainers(world, trainers);
  const trainingCommands = createTrainingCommands(world, safeTrainers, unitTypeData);

  // Collect all valid, non-undefined unit tags
  const validTags = trainingCommands.flatMap(command => command.unitTags || [])
    .filter(tag => typeof tag === 'string'); // Ensure only strings are included

  // Fetch units by valid tags
  const trainerUnits = world.resources.get().units.getByTag(validTags);

  // Create a map from tags to units for quick access
  const tagToUnitMap = new Map(trainerUnits.map(unit => [unit.tag, unit]));

  // Set pending orders in bulk
  trainingCommands.forEach(command => {
    (command.unitTags || []).forEach(tag => {
      if (tag) { // Ensure tag is not undefined
        const trainerUnit = tagToUnitMap.get(tag);
        if (trainerUnit) {
          setPendingOrders(trainerUnit, command);
        }
      }
    });
  });

  return trainingCommands;
}

/**
 * Optimizes the training of units based on the current game state and strategic needs.
 * @param {World} world The game world context.
 * @param {import("../../features/strategy/strategyManager").PlanStep} step The current strategy step.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of unit training commands.
 */
function handleUnitTraining(world, step) {
  if (!world.agent.race || !step.unitType) return [];

  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed() + EarmarkManager.getEarmarkedFood();
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
  const notOutpowered = !StrategyContext.getInstance().getOutpowered();

  return sufficientMinerals && (shortOnWorkers(world) || getAffordableFoodDifference(world) > 0) && notOutpowered && productionPossible;
}

/**
 * Train a unit.
 * @param {World} world The current game world.
 * @param {UnitTypeId} unitTypeId Type of the unit to train.
 * @param {number | null} targetCount Target number of units.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]}
 */
function train(world, unitTypeId, targetCount = null) {
  const unitTypeData = world.data.getUnitTypeData(unitTypeId);
  if (!unitTypeData.abilityId) return [];

  // Check if we can train the unit considering the target count
  if (!canTrainUnit(world, unitTypeId, targetCount)) return [];

  // First check affordability before earmarking resources
  const canAffordNow = world.agent.canAfford(unitTypeId);
  earmarkResourcesIfNeeded(world, unitTypeData, true);

  // Only proceed with training if we can afford the unit after checking affordability
  if (canAffordNow) {
    return handleTrainingActions(world, unitTypeId, unitTypeData);
  }

  // Can't afford now, but resources are earmarked for future
  return [];
}

/**
 * Trains combat units based on the current strategy and game state.
 * @param {World} world The game world context.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} An array of actions to be performed.
 */
function trainCombatUnits(world) {
  const { agent } = world;
  if (!agent.minerals || !agent.vespene) return [];

  const strategyContext = StrategyContext.getInstance();
  if (!strategyContext.getCurrentStrategy()) {
    console.error('Current strategy is undefined.');
    return [];
  }

  const candidateTypesToBuild = filterCandidateTypes(world);
  if (candidateTypesToBuild.length === 0) return [];

  const selectedType = selectUnitTypeToBuild(world, candidateTypesToBuild);
  if (!selectedType) return [];

  return strategyContext.getOutpowered() || agent.canAfford(selectedType) ? train(world, selectedType) : [];
}

/**
 * Train workers for all races, considering the unique Zerg training mechanism and ability availability.
 * @param {World} world - The game world context, containing all necessary game state information.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of actions to be sent to the game.
 */
function trainWorkers(world) {
  const { agent, resources } = world;
  const { minerals, race } = agent;

  if (minerals === undefined || race === undefined) return [];

  const workerTypeId = WorkerRace[race]; // Assuming WorkerRace is a predefined mapping
  const workerTypeData = getUnitTypeData(world, workerTypeId);
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
  earmarkWorkersForTraining,
  handleUnitTraining,
  shouldTrainWorkers,
  train,
  trainCombatUnits,
  trainWorkers,
};