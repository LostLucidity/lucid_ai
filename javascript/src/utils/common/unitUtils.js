const { UnitType, WarpUnitAbility } = require("@node-sc2/core/constants");
const { WorkerRace } = require("@node-sc2/core/constants/race-map");

const { getBasicProductionUnits } = require("./trainingHelpers");
const GameState = require("../../core/gameState");
const StrategyManager = require("../../features/strategy/strategyManager");
const { getPendingOrders } = require("../gameLogic/stateManagement");
const { checkTechRequirement } = require("../gameLogic/techRequirementUtils");
const { isTrainingOrder } = require("../gameLogic/unitCapabilityUtils");
const { haveSupplyForUnit } = require("../resourceManagement/resourceManagement");
const { addEarmark } = require("../resourceManagement/resourceUtils");

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
  const { agent } = world; // Destructure data from world here
  let affordableUnits = 0;

  for (let i = 0; i < maxUnits; i++) {
    if (agent.canAfford(workerRaceData) && haveSupplyForUnit(world, workerRaceData)) {
      affordableUnits++;

      // Use the cached version of getUnitTypeData
      const unitTypeData = getCachedUnitTypeData(world, workerRaceData);
      if (!unitTypeData) {
        console.error(`No unit type data found for ID: ${workerRaceData}`);
        break; // Exit the loop if the unit data cannot be found
      }

      addEarmark(world.data, unitTypeData); // Pass the UnitTypeData to addEarmark
    } else {
      break; // Exit loop if a unit cannot be afforded or there's no supply
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

  // Calculate the max orders and get the tech requirement once
  const maxOrders = unit.hasReactor() ? 2 : 1;
  const { techRequirement } = world.data.getUnitTypeData(unitType);

  // Check for tech requirements
  if (techRequirement && !checkTechRequirement(world.resources, techRequirement, unit)) {
    return false;
  }

  // Combine and filter orders in one go
  const currentAndPendingOrders = unit.orders
    .concat(getPendingOrders(unit))
    .filter(order => isTrainingOrder(order, world.data))
    .length;

  return currentAndPendingOrders < maxOrders;
}

/**
 * Calculates the affordable food difference based on the next step in the build plan.
 * @param {World} world The game world context.
 * @returns {number} The number of affordable units based on food supply.
 */
function getAffordableFoodDifference(world) {
  const { agent, data } = world;
  const race = agent.race;

  // Validate race
  if (!race || !WorkerRace[race]) return 0;

  const workerRaceData = WorkerRace[race];
  const unitData = data.getUnitTypeData(workerRaceData);
  if (!unitData || !unitData.abilityId) return 0;

  const foodUsed = GameState.getInstance().getFoodUsed();
  const plan = StrategyManager.getInstance().getCurrentStrategy();
  if (!plan || !plan.steps) {
    console.error('Current strategy plan is undefined or invalid.');
    return 0;
  }

  const nextStep = plan.steps.find(step => parseInt(step.supply, 10) >= foodUsed);
  if (!nextStep) return 0; // No further steps or already at the last step

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
  // Check if the data is already in the cache
  if (unitTypeDataCache.has(unitTypeId)) {
    return unitTypeDataCache.get(unitTypeId);
  }

  // If not in the cache, retrieve it and add to the cache
  const unitTypeData = world.data.getUnitTypeData(unitTypeId);
  if (unitTypeData) {
    unitTypeDataCache.set(unitTypeId, unitTypeData);
  }

  return unitTypeData;
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

// Export shared utilities
module.exports = {
  productionUnitsCache,
  unitTypeDataCache,
  unitProductionAvailable,
  getAffordableFoodDifference,
  haveAvailableProductionUnitsFor,
};
