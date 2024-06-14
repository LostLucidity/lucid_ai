// src/utils/gameLogic/stateManagement.js
// Import necessary dependencies
const { UnitType } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");

const { getTimeInSeconds } = require("./pathfinding");
const { getDistance } = require("./spatialCoreUtils");
const { missingUnits } = require("../../features/misc/gameDataStore");
const { GameState } = require("../../gameState");
const { getPendingOrders } = require("../../sharedServices");
const { getWeaponDPS } = require("../../units");
const { getById } = require("../../utils/generalUtils");
const { calculateTimeToKillUnits } = require("../../utils/sharedUtils");

/**
 * Calculates the remaining time to finish a structure's construction.
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @returns {number} Time left in seconds
 */
function calculateTimeToFinishStructure(data, unit) {
  if (typeof unit.unitType !== 'number') return 0;

  const { buildTime } = data.getUnitTypeData(unit.unitType);
  if (typeof buildTime !== 'number' || typeof unit.buildProgress !== 'number') return 0;

  const timeElapsed = buildTime * unit.buildProgress;
  return getTimeInSeconds(buildTime - timeElapsed);
}

/**
 * Analyzes the game state and determines if the current count of a 
 * specific unit type matches the target count based on the provided comparison mode.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} targetCount
 * @param {boolean} [checkAtLeast=false] - If true, checks if the count is at least the target count. Otherwise, checks if it is less than the target count.
 * @returns {boolean}
 */
function checkUnitCount(world, unitType, targetCount, checkAtLeast = false) {
  const { data, resources } = world;
  const units = resources.get().units;
  const unitTypeData = data.getUnitTypeData(unitType);

  if (!unitTypeData) return false;

  const { abilityId } = unitTypeData;
  if (!abilityId) return false;

  const unitTypes = GameState.getInstance().morphMapping?.get(unitType) || [unitType];
  const allUnits = units.getAlive(Alliance.SELF);

  /**
   * Gets the count of units with a specific order.
   * @param {Array<Unit>} unitArray - Array of units to check.
   * @returns {number} - Count of units with the specified order.
   */
  const getUnitOrderCount = (unitArray) =>
    unitArray.reduce((count, unit) => count + (unit.orders?.some(order => order.abilityId === abilityId) ? 1 : 0), 0);

  const orderedUnitsCount = getUnitOrderCount(allUnits);
  const pendingOrders = allUnits.flatMap(u => getPendingOrders(u) || []);

  /**
   * Gets the count of pending units with a specific order.
   * @param {Array<SC2APIProtocol.ActionRawUnitCommand>} orderArray - Array of orders to check.
   * @returns {number} - Count of units with the specified pending order.
   */
  const getPendingOrderCount = (orderArray) =>
    orderArray.reduce((count, order) => count + (order.abilityId === abilityId ? 1 : 0), 0);

  const pendingUnitsCount = getPendingOrderCount(pendingOrders);

  const baseUnitCount = getById(resources, unitTypes).length;
  const adjustedOrderedUnitsCount = (unitType === UnitType.ZERGLING ? 2 * orderedUnitsCount : orderedUnitsCount);
  const actualUnitCount = baseUnitCount + adjustedOrderedUnitsCount + pendingUnitsCount;

  const missingUnitCount = missingUnits.filter(unit => unit.unitType === unitType).length;
  const totalUnitCount = actualUnitCount + missingUnitCount;

  const adjustedTargetCount = (unitType === UnitType.ZERGLING)
    ? targetCount + (baseUnitCount % 2)
    : targetCount;

  return checkAtLeast ? totalUnitCount >= adjustedTargetCount : totalUnitCount < adjustedTargetCount;
}

/**
 * Determines the bot's race, defaulting to Terran if undefined.
 * @param {World} world - The game world context.
 * @returns {SC2APIProtocol.Race} The determined race of the bot.
 */
function determineBotRace(world) {
  return world.agent.race || Race.TERRAN;
}

/**
 * Determines if a townhall is in danger based on nearby enemy units.
 * @param {World} world - The current world context.
 * @param {Unit} townhall - The townhall unit.
 * @param {Unit[]} nearbyEnemies - Array of nearby enemy units.
 * @returns {boolean} - True if townhall is in danger, otherwise false.
 */
function isTownhallInDanger(world, townhall, nearbyEnemies) {
  const selfDefenseUnits = world.resources.get().units.getCombatUnits().filter(unit => {
    const distance = getDistance(unit.pos, townhall.pos);
    return distance !== undefined && distance < 10; // 10 units radius for defense
  });

  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfDefenseUnits, nearbyEnemies, getWeaponDPS);
  return timeToBeKilled <= timeToKill;
}

module.exports = {
  calculateTimeToFinishStructure,
  checkUnitCount,
  determineBotRace,
  isTownhallInDanger,
};
