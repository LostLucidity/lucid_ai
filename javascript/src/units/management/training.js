const { UnitType } = require("@node-sc2/core/constants");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { getBasicProductionUnits } = require("./basicUnitUtils");
const { createTrainingCommands } = require("./trainingCommands");
const { canTrainUnit } = require("./trainingUtils");
const { unitTypeTrainingAbilities, flyingTypesMapping } = require("./unitConfig");
const { setPendingOrders } = require("./unitOrders");
const { EarmarkManager } = require("../../core");
const { getUnitTypeData } = require("../../core/gameData");
const StrategyContext = require("../../features/strategy/utils/strategyContext");
const { selectUnitTypeToBuild } = require("../../features/strategy/utils/unitSelection");
const { getBuildTimeLeft, shortOnWorkers } = require("../../gameLogic/economy/workerService");
const { filterSafeTrainers } = require("../../gameLogic/gameMechanics/gameStrategyUtils");
const { GameState } = require('../../gameState');
const { getPendingOrders } = require("../../sharedServices");
const { findKeysForValue, createUnitCommand, findUnitTypesWithAbilityCached } = require("../../utils/common");
const { getById } = require("../../utils/generalUtils");
const { haveAvailableProductionUnitsFor, getAffordableFoodDifference } = require("../../utils/unitUtils");

/**
 * Checks if a unit can train the specified unit type.
 * @param {World} world The game world context.
 * @param {Unit} unit The unit to check.
 * @param {number} abilityId The ability ID required to train the unit type.
 * @param {number} threshold The time in frames or seconds until the next call (dynamic threshold).
 * @returns {boolean} True if the unit can train the specified unit type, false otherwise.
 */
function canTrainUnitType(world, unit, abilityId, threshold) {
  const { data } = world;
  if (!unit.buildProgress || unit.buildProgress < 1 || unit.labels.has('reposition')) return false;

  const orders = unit.orders || [];
  const pendingOrders = getPendingOrders(unit);
  if (orders.length + pendingOrders.length > 1) return false;
  if (orders.length === 0) return true;

  const firstOrder = orders[0];
  if (firstOrder.abilityId === undefined) return false;

  const unitTypeTraining = unitTypeTrainingAbilities.get(firstOrder.abilityId);
  if (!unitTypeTraining) return false;

  const unitTypeData = data.getUnitTypeData(unitTypeTraining);
  if (!unitTypeData || unitTypeData.buildTime === undefined) return false;

  const buildTimeLeft = getBuildTimeLeft(unit, unitTypeData.buildTime, firstOrder.progress || 0);
  return buildTimeLeft <= threshold && pendingOrders.length === 0;
}

/**
 * Earmarks workers for future training based on available food capacity.
 * @param {World} world The game world context.
 * @param {number} foodAvailable The amount of food capacity available for training workers.
 */
function earmarkWorkersForTraining(world, foodAvailable) {
  const { race } = world.agent;
  if (race) {
    const workerUnitTypeData = world.data.getUnitTypeData(WorkerRace[race]);
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
  const trainingTypes = strategyContext.getTrainingTypes() || [];

  return trainingTypes.filter(type => {
    const unitTypeData = data.getUnitTypeData(type);
    const attributes = unitTypeData.attributes || [];
    const foodRequired = unitTypeData.foodRequired || 0;
    const supply = currentPlanStep ? parseInt(currentPlanStep.supply, 10) : 0;

    const isPlannedType = currentStrategy.steps.some(step => {
      const actions = Array.isArray(step.interpretedAction) ? step.interpretedAction : [step.interpretedAction];
      return actions.some(action => action && action.unitType === type);
    });

    return isPlannedType &&
      !attributes.includes(Attribute.STRUCTURE) &&
      foodRequired <= supply - gameState.getFoodUsed() &&
      gameState.checkTechFor(world.agent, type) &&
      gameState.checkProductionAvailability(type);
  });
}

/**
 * Gets trainers that can produce a specific unit type, including those nearly finished training other units.
 * @param {World} world The game world context.
 * @param {UnitTypeId} unitTypeId The type ID of the unit to train.
 * @param {number} threshold The time in frames or seconds until the next call (dynamic threshold).
 * @returns {Unit[]} Array of units that can train the specified unit type.
 */
function getTrainer(world, unitTypeId, threshold) {
  const { WARPGATE } = UnitType;
  const { data } = world;
  const abilityId = data.getUnitTypeData(unitTypeId)?.abilityId;
  if (abilityId === undefined) return [];

  const unitTypesWithAbility = findUnitTypesWithAbilityCached(data, abilityId);
  const units = world.resources.get().units;

  const productionUnits = getBasicProductionUnits(world, unitTypeId).filter(unit =>
    canTrainUnitType(world, unit, abilityId, threshold)
  );
  const warpgateUnits = units.getById(WARPGATE).filter(unit =>
    canTrainUnitType(world, unit, abilityId, threshold)
  );
  const flyingUnits = getUnitsByAbility(world, unitTypeId, threshold, unitTypesWithAbility);

  return [...new Set([...productionUnits, ...warpgateUnits, ...flyingUnits])];
}

/**
 * Gets units that can train the specified unit type from a given set of unit types.
 * @param {World} world The game world context.
 * @param {number} unitTypeId The type ID of the unit to train.
 * @param {number} threshold The time in frames or seconds until the next call (dynamic threshold).
 * @param {number[]} unitTypesWithAbility Array of unit types that can use the required ability.
 * @returns {Unit[]} Array of units that can train the specified unit type.
 */
function getUnitsByAbility(world, unitTypeId, threshold, unitTypesWithAbility) {
  const { resources } = world;
  const units = resources.get().units;

  return unitTypesWithAbility.flatMap(type => {
    const unitIds = findKeysForValue(flyingTypesMapping, type);
    return units.getById(unitIds).filter(unit => canTrainUnitType(world, unit, unitTypeId, threshold));
  });
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

  const validTags = trainingCommands.flatMap(command => command.unitTags || []).filter(tag => typeof tag === 'string');
  const trainerUnits = world.resources.get().units.getByTag(validTags);
  const tagToUnitMap = new Map(trainerUnits.map(unit => [unit.tag, unit]));

  trainingCommands.forEach(command => {
    (command.unitTags || []).forEach(tag => {
      if (tag) {
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
 * @param {import("../../features/strategy/utils/strategyManager").PlanStep} step The current strategy step.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} A list of unit training commands.
 */
function handleUnitTraining(world, step) {
  if (world.agent.race == null || step.unitType == null) return [];

  const gameState = GameState.getInstance();
  const foodUsed = gameState.getFoodUsed() + EarmarkManager.getEarmarkedFood();
  const foodAvailable = (step.food || 0) - foodUsed;
  if (foodAvailable <= 0) return [];

  let trainingOrders = shouldTrainWorkers(world) ? trainWorkers(world) : [];

  if (trainingOrders.length === 0) {
    trainingOrders = trainCombatUnits(world);
  }

  if (trainingOrders.length === 0 && WorkerRace[world.agent.race]) {
    earmarkWorkersForTraining(world, foodAvailable);
  }

  return trainingOrders;
}

/**
 * Analyzes the game state and decides if workers should be trained.
 * @param {World} world - The current game world context.
 * @returns {boolean} - True if conditions are met for training workers, false otherwise.
 */
function shouldTrainWorkers(world) {
  const { agent, resources } = world;

  if (!agent.race || !agent.canAfford(WorkerRace[agent.race])) {
    return false;
  }

  const workerCount = getById(resources, [WorkerRace[agent.race]]).length;
  const bases = resources.get().units.getBases();
  const gasMines = resources.get().units.getGasMines();
  const assignedWorkerCount = [...bases, ...gasMines].reduce((acc, unit) => acc + (unit.assignedHarvesters || 0), 0);
  const minimumWorkerCount = Math.min(workerCount, assignedWorkerCount);

  // Ensure minerals is defined before performing the comparison
  const sufficientMinerals = typeof agent.minerals === 'number' && (agent.minerals < 512 || minimumWorkerCount <= 36);
  const productionPossible = haveAvailableProductionUnitsFor(world, WorkerRace[agent.race]);
  const notOutpowered = !StrategyContext.getInstance().getOutpowered();

  return sufficientMinerals && (shortOnWorkers(world) || getAffordableFoodDifference(world) > 0) && notOutpowered && productionPossible;
}

/**
 * Train a unit.
 * @param {World} world - The current game world.
 * @param {UnitTypeId} unitTypeId - Type of the unit to train.
 * @param {number | null} targetCount - Target number of units.
 * @returns {SC2APIProtocol.ActionRawUnitCommand[]} - List of unit training actions.
 */
function train(world, unitTypeId, targetCount = null) {
  const unitTypeData = world.data.getUnitTypeData(unitTypeId);

  // Check if the unit type has a valid ability ID
  if (!unitTypeData.abilityId) {
    return [];
  }

  // Calculate available supply and required supply
  const foodCap = world.agent.foodCap ?? 0;
  const foodUsed = world.agent.foodUsed ?? 0;
  const availableSupply = foodCap - foodUsed;
  const requiredSupply = unitTypeData.foodRequired || 0;

  // Check if there is enough available supply to train the unit
  if (availableSupply < requiredSupply) {
    return [];
  }

  // Check if the agent can afford the unit
  if (!world.agent.canAfford(unitTypeId)) {
    return [];
  }

  // Check if the unit can be trained based on target count and other conditions
  if (!canTrainUnit(world, unitTypeId, targetCount)) {
    return [];
  }

  // Handle the unit training actions
  return handleTrainingActions(world, unitTypeId, unitTypeData);
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

  if (!minerals || !race) return [];

  const workerTypeId = WorkerRace[race];
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
        setPendingOrders(larva, unitCommand);
        break;
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
        setPendingOrders(base, unitCommand);
        break;
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
