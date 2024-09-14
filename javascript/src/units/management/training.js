const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { getBasicProductionUnits } = require("./basicUnitUtils");
const { createTrainingCommands } = require("./trainingCommands");
const { canTrainUnit } = require("./trainingUtils");
const { unitTypeTrainingAbilities, flyingTypesMapping } = require("./unitConfig");
const { setPendingOrders } = require("./unitOrders");
const { canLarvaInitiateTraining, canBaseInitiateTraining } = require("./unitTrainingUtils");
const { findKeysForValue, createUnitCommand, findUnitTypesWithAbilityCached } = require("../../core/common");
const EarmarkManager = require("../../core/earmarkManager");
const { getUnitTypeData } = require("../../core/gameData");
const StrategyContext = require("../../features/strategy/strategyContext");
const { selectUnitTypeToBuild } = require("../../features/strategy/unitSelection");
const { getBuildTimeLeft, shortOnWorkers } = require("../../gameLogic/economy/workerService");
const { filterSafeTrainers } = require("../../gameLogic/gameMechanics/gameStrategyUtils");
const { getPendingOrders } = require("../../services/sharedServices");
const { GameState } = require('../../state');
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
  if ((unit.buildProgress ?? 0) < 1 || unit.labels.has('reposition')) return false;

  const orders = unit.orders || [];
  const pendingOrders = getPendingOrders(unit);

  if (pendingOrders.length > 0 || orders.length > 1) return false;

  if (orders.length === 0) {
    return unit.abilityAvailable(abilityId);
  }

  const firstOrder = orders[0];
  if (firstOrder.abilityId === undefined) return false;

  if (!unit.abilityAvailable(abilityId) || !unit.abilityAvailable(firstOrder.abilityId)) return false;

  const unitTypeTraining = unitTypeTrainingAbilities.get(firstOrder.abilityId);
  if (!unitTypeTraining) return false;

  const unitTypeData = world.data.getUnitTypeData(unitTypeTraining);
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
 * Filters units by their ability to train a specific unit type within a threshold.
 * @param {World} world The game world context.
 * @param {Unit[]} unitList The list of units to filter.
 * @param {number} ability The ability ID to check against.
 * @param {number} threshold The time in frames or seconds until the next call (dynamic threshold).
 * @returns {Unit[]} The filtered list of units that can train the unit type.
 */
function filterUnitsByTrainingAbility(world, unitList, ability, threshold) {
  return unitList.filter(unit => canTrainUnitType(world, unit, ability, threshold));
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
  const { data, resources } = world;
  const abilityId = data.getUnitTypeData(unitTypeId)?.abilityId;
  if (abilityId === undefined) return [];

  const unitTypesWithAbility = findUnitTypesWithAbilityCached(data, abilityId);
  const units = resources.get().units;

  const productionUnits = filterUnitsByTrainingAbility(
    world,
    getBasicProductionUnits(world, unitTypeId),
    abilityId,
    threshold
  );
  const warpgateUnits = filterUnitsByTrainingAbility(
    world,
    units.getById(WARPGATE),
    WarpUnitAbility[unitTypeId],
    threshold
  );
  const flyingUnits = getUnitsByAbility(world, unitTypeId, threshold, unitTypesWithAbility);

  return Array.from(new Set([...productionUnits, ...warpgateUnits, ...flyingUnits]));
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

  setPendingOrdersForUnits(world, trainingCommands);

  return trainingCommands;
}

/**
 * Sets pending orders for units based on training commands.
 * @param {World} world - The game world context.
 * @param {SC2APIProtocol.ActionRawUnitCommand[]} trainingCommands - The list of training commands.
 */
function setPendingOrdersForUnits(world, trainingCommands) {
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

  if (!unitTypeData.abilityId) return [];

  const { foodCap = 0, foodUsed = 0 } = world.agent;
  const availableSupply = foodCap - foodUsed;
  const requiredSupply = unitTypeData.foodRequired || 0;

  if (availableSupply < requiredSupply) return [];
  if (!world.agent.canAfford(unitTypeId)) return [];
  if (unitTypeData.techRequirement && !world.agent.hasTechFor(unitTypeId)) return [];
  if (!canTrainUnit(world, unitTypeId, targetCount)) return [];

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
      if (canLarvaInitiateTraining(larva, abilityId)) {
        const unitCommand = createUnitCommand(abilityId, [larva]);
        collectedActions.push(unitCommand);
        setPendingOrders(larva, unitCommand);
        break;
      }
    }
  } else {
    const bases = resources.get().units.getBases();
    for (const base of bases) {
      if (canBaseInitiateTraining(base, abilityId)) {
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
  shouldTrainWorkers,
  train,
  trainCombatUnits,
  trainWorkers,
};
