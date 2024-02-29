const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");

const { earmarkResourcesIfNeeded } = require("./sharedEconomicFunctions");
const { getBasicProductionUnits } = require("./trainingHelpers");
const { createTrainingCommands } = require("./unitActions");
const { flyingTypesMapping } = require("./unitConfig");
const { getUnitTypeCount } = require("./unitHelpers");
const { findKeysForValue } = require("./utils");
const { filterSafeTrainers } = require("../gameLogic/gameStrategyUtils");
const { getPendingOrders } = require("../gameLogic/stateManagement");
const { canTrainUnit } = require("../gameLogic/unitCapabilityUtils");

/**
 * @param {World} world
 * @param {UnitTypeId} unitTypeId
 * @returns {Unit[]}
 */
function getTrainer(world, unitTypeId) {
  const { WARPGATE } = UnitType;
  const { data, resources } = world;
  const { units } = resources.get();
  let { abilityId } = data.getUnitTypeData(unitTypeId); if (abilityId === undefined) return [];

  const unitFilter = (/** @type {Unit} */ unit) => {
    const { orders } = unit;
    const pendingOrders = getPendingOrders(unit);
    if (abilityId === undefined || orders === undefined || pendingOrders === undefined) return false;
    const allOrders = [...orders, ...pendingOrders];
    const spaceToTrain = allOrders.length === 0 || (unit.hasReactor() && allOrders.length < 2);
    return spaceToTrain && unit.abilityAvailable(abilityId) && !unit.labels.has('reposition');
  };

  let productionUnits = getBasicProductionUnits(world, unitTypeId).filter(unitFilter);

  if (productionUnits.length === 0) {
    const abilityId = WarpUnitAbility[unitTypeId];
    productionUnits = units.getById(WARPGATE).filter(warpgate => abilityId && warpgate.abilityAvailable(abilityId));
  }

  // Check for flying units
  const unitTypesWithAbility = data.findUnitTypesWithAbility(abilityId);
  const flyingTypes = unitTypesWithAbility.flatMap(value => findKeysForValue(flyingTypesMapping, value));
  const flyingUnits = units.getById(flyingTypes).filter(unit => unit.isIdle());

  productionUnits = [...productionUnits, ...flyingUnits];

  return productionUnits;
}

/**
 * @param {World} world
 * @param {number} unitTypeId
 * @param {SC2APIProtocol.UnitTypeData} unitTypeData
 */
function handleTrainingActions(world, unitTypeId, unitTypeData) {
  const trainers = getTrainer(world, unitTypeId);
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
