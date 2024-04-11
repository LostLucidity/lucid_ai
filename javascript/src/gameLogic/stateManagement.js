// src/utils/gameLogic/stateManagement.js
// Import necessary dependencies, if any

const { UnitType } = require("@node-sc2/core/constants");
const { Alliance, Race } = require("@node-sc2/core/constants/enums");

const GameState = require("../core/gameState");
const { calculateTimeToKillUnits } = require("../core/sharedUtils");
const { getWeaponDPS } = require("../core/unitCalculations");
const { getPendingOrders } = require("../sharedServices");
const { missingUnits } = require("../utils/misc/gameDataStore");
const { getById } = require("../utils/misc/gameUtils");
const { getTimeInSeconds } = require("../utils/pathfinding/pathfinding");
const { getDistance } = require("../utils/spatial/spatialCoreUtils");

/**
 * Calculates the remaining time to finish a structure's construction.
 * @param {DataStorage} data
 * @param {Unit} unit 
 * @returns {number} Time left in seconds
 */
function calculateTimeToFinishStructure(data, unit) {
  // Check if unitType is defined
  if (typeof unit.unitType === 'number') {
    const { buildTime } = data.getUnitTypeData(unit.unitType);
    // Check if both buildTime and buildProgress are defined
    if (typeof buildTime === 'number' && typeof unit.buildProgress === 'number') {
      const timeElapsed = buildTime * unit.buildProgress;
      const timeLeft = getTimeInSeconds(buildTime - timeElapsed);
      return timeLeft;
    }
  }
  return 0; // Return 0 if unitType, buildTime, or buildProgress is undefined
}

/**
 * Analyzes the game state and determines if the current count of a 
 * specific unit type matches the target count.
 * @param {World} world
 * @param {UnitTypeId} unitType
 * @param {number} targetCount
 * @returns {boolean}
 */
function checkUnitCount(world, unitType, targetCount) {
  const { data, resources } = world;
  const units = resources.get().units;
  const abilityId = data.getUnitTypeData(unitType).abilityId;

  if (!abilityId) {
    return false;
  }

  const unitTypes = GameState.getInstance().morphMapping?.get(unitType) || [unitType];
  const allUnits = units.getAlive(Alliance.SELF);

  const orderedUnits = allUnits.filter(u => u.orders?.some(o => o.abilityId === abilityId)).length;
  const unitsWithPendingOrders = allUnits.filter(u => getPendingOrders(u)?.some(o => o.abilityId === abilityId)).length;

  // For Zerglings, count each unit as 2 due to them being trained in pairs
  const actualUnitCount = getById(resources, unitTypes).length +
    (unitType === UnitType.ZERGLING ? 2 * orderedUnits : orderedUnits) +
    unitsWithPendingOrders;

  const missingUnitCount = missingUnits.filter(unit => unit.unitType === unitType).length;
  const totalUnitCount = actualUnitCount + missingUnitCount;

  const adjustedTargetCount = unitType === UnitType.ZERGLING
    ? targetCount + (getById(resources, [UnitType.ZERGLING]).length % 2)
    : targetCount;

  return totalUnitCount < adjustedTargetCount;
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
  // Retrieve self-defense units near the townhall
  const selfDefenseUnits = world.resources.get().units.getCombatUnits().filter(unit => {
    const distance = getDistance(unit.pos, townhall.pos);
    return distance !== undefined && distance < 10; // 10 units radius for defense
  });

  // Calculate time to kill and time to be killed
  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfDefenseUnits, nearbyEnemies, getWeaponDPS);

  // Townhall is in danger if it can be killed faster than the threats can be eliminated
  return timeToBeKilled <= timeToKill;
}

module.exports = {
  calculateTimeToFinishStructure,
  checkUnitCount,
  determineBotRace,
  isTownhallInDanger,
};
