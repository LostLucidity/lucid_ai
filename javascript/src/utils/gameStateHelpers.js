// gameStateHelpers.js

const { UnitType } = require("@node-sc2/core/constants");
const { Race, Alliance } = require("@node-sc2/core/constants/enums");

const { getPendingOrders } = require("./commonGameUtils");
const { missingUnits } = require("../gameDataStore");
const GameState = require("../gameState");
const { getById } = require("../gameUtils");
const { getDistance } = require("../geometryUtils");
const { calculateTimeToKillUnits } = require("../unitHelpers");

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
  const { units } = resources.get();
  const orders = [];
  /** @type {UnitTypeId[]} */
  let unitTypes = []; // Assign an empty array as default

  const gameState = GameState.getInstance();
  if (gameState.morphMapping?.has(unitType)) {
    const mappingValue = gameState.morphMapping.get(unitType);
    if (mappingValue) {
      unitTypes = mappingValue;
    }
  } else {
    unitTypes = [unitType];
  }
  let abilityId = data.getUnitTypeData(unitType).abilityId;

  if (typeof abilityId === 'undefined') {
    // Ability ID for the unit type is not defined, so return false
    return false;
  }
  units.withCurrentOrders(abilityId).forEach(unit => {
    if (unit.orders) {
      unit.orders.forEach(order => {
        if (order.abilityId === abilityId) {
          // Check if the unitType is zergling and account for the pair
          const orderCount = (unitType === UnitType.ZERGLING) ? 2 : 1;
          for (let i = 0; i < orderCount; i++) {
            orders.push(order);
          }
        }
      });
    }
  });

  const unitsWithPendingOrders = units.getAlive(Alliance.SELF).filter(u => {
    const unitPendingOrders = getPendingOrders(u);
    return unitPendingOrders && unitPendingOrders.some(o => o.abilityId === abilityId);
  });

  let adjustedTargetCount = targetCount;
  if (unitType === UnitType.ZERGLING) {
    const existingZerglings = getById(resources, [UnitType.ZERGLING]).length;
    const oddZergling = existingZerglings % 2;
    adjustedTargetCount += oddZergling;
  }

  const unitCount = getById(resources, unitTypes).length + orders.length + unitsWithPendingOrders.length + missingUnits.filter(unit => unit.unitType === unitType).length;

  return unitCount === adjustedTargetCount;
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
  const { timeToKill, timeToBeKilled } = calculateTimeToKillUnits(world, selfDefenseUnits, nearbyEnemies);

  // Townhall is in danger if it can be killed faster than the threats can be eliminated
  return timeToBeKilled <= timeToKill;
}

module.exports = {
  checkUnitCount,
  determineBotRace,
  isTownhallInDanger,
};
