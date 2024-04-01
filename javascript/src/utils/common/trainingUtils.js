const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");

const { earmarkResourcesIfNeeded } = require("./sharedEconomicFunctions");
const { getBuildTimeLeft } = require("./sharedUtils");
const { getBasicProductionUnits } = require("./trainingHelpers");
const { createTrainingCommands } = require("./unitActions");
const { flyingTypesMapping, unitTypeTrainingAbilities } = require("./unitConfig");
const { getUnitTypeCount } = require("./unitHelpers");
const { findKeysForValue } = require("./utils");
const GameState = require("../../core/gameState");
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
  let { abilityId } = data.getUnitTypeData(unitTypeId);
  if (abilityId === undefined) return [];

  const idleOrAlmostIdleFilter = (/** @type {Unit} */ unit) => {
    const { buildProgress, orders } = unit;
    if (!buildProgress || buildProgress < 1) return false;

    // If no visible orders and no pending orders, the unit is idle
    if ((!orders || orders.length === 0) && getPendingOrders(unit).length === 0) return true;

    const order = orders?.[0];
    if (!order || order.abilityId === undefined) return false;

    const unitTypeTraining = unitTypeTrainingAbilities.get(order.abilityId);
    if (!unitTypeTraining) return false;

    const unitTypeData = data.getUnitTypeData(unitTypeTraining);
    if (!order.progress || !unitTypeData || unitTypeData.buildTime === undefined) return false;

    const buildTimeLeft = getBuildTimeLeft(unit, unitTypeData.buildTime, order.progress);

    // Unit is almost idle if the build time left for the first order is within the threshold,
    // there are no further orders in the queue, and no pending orders
    return buildTimeLeft <= threshold && orders.length === 1 && getPendingOrders(unit).length === 0;
  };

  const unitFilter = (/** @type {Unit} */ unit) => {
    const { orders } = unit;
    const pendingOrders = getPendingOrders(unit);
    if (!abilityId || !orders || !pendingOrders) return false;

    const allOrders = [...orders, ...pendingOrders];
    const spaceToTrain = allOrders.length === 0 || (unit.hasReactor() && allOrders.length < 2);
    return (spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition')) || idleOrAlmostIdleFilter(unit);
  };

  let productionUnits = getBasicProductionUnits(world, unitTypeId).filter(unitFilter);

  if (productionUnits.length === 0) {
    const warpgateAbilityId = WarpUnitAbility[unitTypeId];
    productionUnits = units.getById(WARPGATE).filter(warpgate => warpgateAbilityId && warpgate.abilityAvailable(warpgateAbilityId));
  }

  // Check for flying units
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
  const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
  const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle());

  productionUnits = [...new Set([...productionUnits, ...flyingUnits])]; // Remove duplicates

  return productionUnits;
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

  let earmarkNeeded = targetCount && getUnitTypeCount(world, unitTypeId) < targetCount;

  if (!canTrainUnit(world, unitTypeId, targetCount)) return [];
  earmarkNeeded = earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);

  const collectedActions = handleTrainingActions(world, unitTypeId, unitTypeData);
  earmarkResourcesIfNeeded(world, unitTypeData, earmarkNeeded);

  return collectedActions;
}

module.exports = {
  train,
};
