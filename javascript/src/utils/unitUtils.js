const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { checkTechRequirement } = require("./resourceUtils");
const EarmarkManager = require("../core/earmarkManager");
const StrategyContext = require("../features/strategy/strategyContext").getInstance();
const { getPendingOrders } = require("../services/sharedServices");
const GameState = require('../state').GameState.getInstance();
const { getBasicProductionUnits } = require("../units/management/basicUnitUtils");
const { haveSupplyForUnit } = require("../units/management/unitCommonUtils.js");
const { unitTypeTrainingAbilities } = require("../units/management/unitConfig");
const { unitPendingOrders } = require("../units/management/unitOrders");

/** @type {Map<UnitTypeId, Unit[]>} */
const productionUnitsCache = new Map();

/** @type {boolean} */
let unitProductionAvailable = true;

/** @type {Map<number, SC2APIProtocol.UnitTypeData>} */
const unitTypeDataCache = new Map();

/**
 * Calculates how many units can be afforded and have supply for, up to a maximum.
 * @param {World} world The game world context.
 * @param {UnitTypeId} workerRaceData The data for the worker race.
 * @param {number} maxUnits The maximum number of units to check.
 * @returns {number} The number of affordable units with available supply.
 */
function calculateAffordableUnits(world, workerRaceData, maxUnits) {
  const { agent } = world;
  let affordableUnits = 0;

  for (let i = 0; i < maxUnits; i++) {
    if (agent.canAfford(workerRaceData) && haveSupplyForUnit(world, workerRaceData)) {
      affordableUnits++;

      const unitTypeData = getCachedUnitTypeData(world, workerRaceData);
      if (!unitTypeData) {
        console.error(`No unit type data found for ID: ${workerRaceData}`);
        break;
      }

      EarmarkManager.getInstance().addEarmark(world.data, unitTypeData);
    } else {
      break;
    }
  }

  return affordableUnits;
}

/**
 * Check if unit can train now.
 * @param {World} world
 * @param {Unit} unit 
 * @param {UnitTypeId} unitType
 * @returns {boolean}
 */
const canTrainNow = (world, unit, unitType) => {
  if (!unit.orders || unit.buildProgress === undefined) return false;

  const maxOrders = unit.hasReactor() ? 2 : 1;
  const { techRequirement } = world.data.getUnitTypeData(unitType);

  if (techRequirement && !checkTechRequirement(world.resources, techRequirement, unit)) {
    return false;
  }

  const currentAndPendingOrders = unit.orders
    .concat(getPendingOrders(unit))
    .filter(order => isTrainingOrder(order, world.data))
    .length;

  return currentAndPendingOrders < maxOrders;
};

/**
 * Clears pending orders for all units to ensure they are ready for new commands.
 * @param {Unit[]} units - The units whose pending orders need to be cleared.
 */
function clearAllPendingOrders(units) {
  units.forEach(unit => {
    unitPendingOrders.delete(unit);
  });
}

/**
 * Calculates the affordable food difference based on the next step in the build plan.
 * @param {World} world The game world context.
 * @returns {number} The number of affordable units based on food supply.
 */
function getAffordableFoodDifference(world) {
  const { agent, data } = world;
  const race = agent.race;

  if (!race || !WorkerRace[race]) return 0;

  const workerRaceData = WorkerRace[race];
  const unitData = data.getUnitTypeData(workerRaceData);
  if (!unitData || !unitData.abilityId) return 0;

  const foodUsed = GameState.getFoodUsed();
  const plan = StrategyContext.getCurrentStrategy();
  if (!plan || !plan.steps) {
    console.error('Current strategy plan is undefined or invalid.');
    return 0;
  }

  const nextStep = plan.steps.find(step => parseInt(step.supply, 10) >= foodUsed);
  if (!nextStep) return 0;

  const foodDifference = parseInt(nextStep.supply, 10) - foodUsed;
  const productionUnits = getBasicProductionUnits(world, workerRaceData).length;
  const potentialUnits = Math.min(foodDifference, productionUnits);

  return calculateAffordableUnits(world, workerRaceData, potentialUnits);
}

/**
 * Retrieves unit type data, using cache to avoid repeated lookups.
 * @param {World} world The game world context.
 * @param {number} unitTypeId The ID of the unit type to retrieve.
 * @returns {SC2APIProtocol.UnitTypeData | undefined} The unit type data, or undefined if not found.
 */
function getCachedUnitTypeData(world, unitTypeId) {
  if (unitTypeDataCache.has(unitTypeId)) {
    return unitTypeDataCache.get(unitTypeId);
  }

  const unitTypeData = world.data.getUnitTypeData(unitTypeId);
  if (unitTypeData) {
    unitTypeDataCache.set(unitTypeId, unitTypeData);
  }

  return unitTypeData;
}

/**
 * Get units by type.
 * @param {World} world - The current game world context.
 * @param {number} unitType - The unit type to find.
 * @returns {Unit[]} A list of units matching the specified type.
 */
function getUnitsById(world, unitType) {
  return world.resources.get().units.getById(unitType);
}

/**
 * Check if unitType has prerequisites to build when minerals are available.
 * @param {World} world 
 * @param {UnitTypeId} unitType 
 * @returns {boolean}
 */
function haveAvailableProductionUnitsFor(world, unitType) {
  const { resources } = world;
  const { units } = resources.get();
  const warpInAbilityId = WarpUnitAbility[unitType];
  const productionUnits = getBasicProductionUnits(world, unitType);
  return (
    units.getById(UnitType.WARPGATE).some(warpgate => warpgate.abilityAvailable(warpInAbilityId)) ||
    productionUnits.some(unit =>
      unit.buildProgress !== undefined &&
      unit.buildProgress >= 1 &&
      !unit.isEnemy() &&
      canTrainNow(world, unit, unitType)
    )
  );
}

/**
 * Check if an order is a training order.
 * @param {SC2APIProtocol.ActionRawUnitCommand} order
 * @param {DataStorage} data
 * @returns {boolean}
 */
function isTrainingOrder(order, data) {
  if (!order.abilityId) return false;
  const trainingUnitType = unitTypeTrainingAbilities.get(order.abilityId);
  return trainingUnitType !== undefined && data.getUnitTypeData(trainingUnitType) !== undefined;
}

/**
 * Sets a reposition label on a unit with a specified position.
 * @param {Unit} unit The unit to set the label on.
 * @param {Point2D} position The position to set as the label.
 */
const setRepositionLabel = (unit, position) => {
  unit.labels.set('reposition', position);
  console.log('reposition', position);
};

// Export shared utilities
module.exports = {
  productionUnitsCache,
  unitTypeDataCache,
  unitProductionAvailable,
  clearAllPendingOrders,
  getAffordableFoodDifference,
  getUnitsById,
  haveAvailableProductionUnitsFor,
  setRepositionLabel,
};
