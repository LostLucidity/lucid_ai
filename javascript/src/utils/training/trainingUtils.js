const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");

const { getBasicProductionUnits } = require("./trainingHelpers");
const { createTrainingCommands } = require("./unitActions");
const { flyingTypesMapping, unitTypeTrainingAbilities } = require("./unitConfig");
const GameState = require("../../core/gameState");
const { filterSafeTrainers } = require("../../gameLogic/gameStrategyUtils");
const { getPendingOrders } = require("../../gameLogic/stateManagement");
const { canTrainUnit } = require("../../gameLogic/unitCapabilityUtils");
const { findKeysForValue } = require("../common/utils");
const { earmarkResourcesIfNeeded } = require("../economy/sharedEconomicFunctions");
const { getBuildTimeLeft } = require("../worker/sharedUtils");

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
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);

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
  return createTrainingCommands(world, safeTrainers, unitTypeData);
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

module.exports = {
  train,
};
