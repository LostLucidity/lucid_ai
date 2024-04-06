const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");

const { earmarkResourcesIfNeeded } = require("./sharedEconomicFunctions");
const { getBuildTimeLeft } = require("./sharedUtils");
const { getBasicProductionUnits } = require("./trainingHelpers");
const { createTrainingCommands } = require("./unitActions");
const { flyingTypesMapping, unitTypeTrainingAbilities } = require("./unitConfig");
const { findKeysForValue } = require("./utils");
const GameState = require("../core/gameState");
const { filterSafeTrainers } = require("../gameLogic/gameStrategyUtils");
const { getPendingOrders } = require("../gameLogic/stateManagement");
const { canTrainUnit } = require("../gameLogic/unitCapabilityUtils");

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
  const { units } = resources.get();
  const abilityId = data.getUnitTypeData(unitTypeId)?.abilityId;
  const warpgateAbilityId = WarpUnitAbility[unitTypeId];

  if (!abilityId) return [];

  const idleOrAlmostIdleFilter = (/** @type {Unit} */ unit) => {
    const buildProgress = unit.buildProgress;
    if (!buildProgress || buildProgress < 1) return false;

    const orders = unit.orders || [];
    const pendingOrders = getPendingOrders(unit);
    if (orders.length + pendingOrders.length === 0) return true;

    const [firstOrder] = orders;
    if (!firstOrder) return false;

    const currentAbilityId = unit.unitType === WARPGATE ? warpgateAbilityId : abilityId;
    if (firstOrder.abilityId !== currentAbilityId) return false;

    const unitTypeTraining = unitTypeTrainingAbilities.get(firstOrder.abilityId);
    if (!unitTypeTraining) return false;

    const unitTypeData = data.getUnitTypeData(unitTypeTraining);
    if (!firstOrder.progress || !unitTypeData || unitTypeData.buildTime === undefined) return false;

    const buildTimeLeft = getBuildTimeLeft(unit, unitTypeData.buildTime, firstOrder.progress);
    return buildTimeLeft <= threshold && orders.length === 1 && getPendingOrders(unit).length === 0;
  };

  let productionUnits = getBasicProductionUnits(world, unitTypeId)
    .filter(unit => unit.abilityAvailable(abilityId) && !unit.labels.has('reposition'))
    .filter(idleOrAlmostIdleFilter);

  const warpgateUnits = units.getById(WARPGATE)
    .filter(warpgate => warpgate.abilityAvailable(warpgateAbilityId) && idleOrAlmostIdleFilter(warpgate));

  productionUnits = [...productionUnits, ...warpgateUnits];

  // Reintroduce flying units handling
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
  const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
  const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle() && idleOrAlmostIdleFilter(unit));

  return [...new Set([...productionUnits, ...flyingUnits])]; // Remove duplicates
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
