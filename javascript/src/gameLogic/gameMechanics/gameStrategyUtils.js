// src/utils/gameStrategyUtils.js

const { Alliance } = require("@node-sc2/core/constants/enums");

const { potentialCombatants, getWeaponDPS } = require("../../units");
const { mappedEnemyUnits } = require("../../utils/scoutingUtils");
const { getDistance } = require("../../utils/spatialCoreUtils");


/**
 * @typedef {Object} GameState
 * @property {import("../../features/strategy/strategyManager").PlanStep[]} plan - An array representing the game plan
 */

const gameStrategyUtils = {
  /**
   * Calculates the time to kill between self units and enemy units,
   * using a function to get the Weapon DPS.
   * 
   * @param {World} world The world context.
   * @param {Unit[]} selfUnits The units on the player's side.
   * @param {Unit[]} enemyUnits The enemy units.
   * @param {(world: World, unitType: UnitTypeId, alliance: Alliance, enemyUnitTypes: UnitTypeId[]) => number} getWeaponDPSFunc Function to calculate weapon DPS.
   * @returns {{ timeToKill: number, timeToBeKilled: number }}
   */
  calculateCombatTimes(world, selfUnits, enemyUnits, getWeaponDPSFunc) {

      if (selfUnits.length === 0) {
    return { timeToKill: Infinity, timeToBeKilled: 0 };
  }

  if (enemyUnits.length === 0) {
    return { timeToKill: 0, timeToBeKilled: Infinity };
  }

  const enemyUnitTypes = enemyUnits
    .map(threat => threat.unitType)
    .filter(unitType => unitType !== undefined);

  const timeToKill = enemyUnits.reduce((timeToKill, threat) => {
    const { health, shield, unitType } = threat;
    if (health === undefined || shield === undefined || unitType === undefined) return timeToKill;
    const totalHealth = health + shield;

    const totalWeaponDPS = selfUnits
      .map(unit => unit.unitType)
      .filter(unitType => unitType !== undefined)
      .map(unitType => getWeaponDPSFunc(world, unitType, Alliance.SELF, enemyUnitTypes))
      .reduce((acc, dps) => acc + dps, 0);

    const timeToKillCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToKill === Infinity) ? timeToKillCurrent : timeToKill + timeToKillCurrent;
  }, Infinity);

  const selfUnitTypes = selfUnits
    .map(unit => unit.unitType)
    .filter(unitType => unitType !== undefined);

  const timeToBeKilled = selfUnits.reduce((timeToBeKilled, unit) => {
    const { health, shield, unitType } = unit;
    if (health === undefined || shield === undefined || unitType === undefined) return timeToBeKilled;
    const totalHealth = health + shield;

    const totalWeaponDPS = enemyUnits
      .map(threat => threat.unitType)
      .filter(unitType => unitType !== undefined)
      .map(unitType => getWeaponDPSFunc(world, unitType, Alliance.ENEMY, selfUnitTypes))
      .reduce((acc, dps) => acc + dps, 0);

    const timeToBeKilledCurrent = totalHealth / (totalWeaponDPS === 0 ? 1 : totalWeaponDPS);
    return (timeToBeKilled === Infinity) ? timeToBeKilledCurrent : timeToBeKilled + timeToBeKilledCurrent;
  }, Infinity);

  return { timeToKill, timeToBeKilled };
  },

  /**
   * @param {World} world
   * @param {Unit[]} trainers
   */
  filterSafeTrainers(world, trainers) {
    return trainers.filter((trainer) => trainer.pos && gameStrategyUtils.isStrongerAtPosition(world, trainer.pos));
  },

  /**
   * Determines if the given step is a BuildOrderStep.
   * @param {import("../../core/globalTypes").BuildOrderStep | import("../../features/strategy/strategyManager").StrategyStep} step
   * @returns {step is import("../../core/globalTypes").BuildOrderStep}
   */
  isBuildOrderStep(step) {
    return 'uniquePropertyOfBuildOrderStep' in step; // Replace with an actual unique property
  },

  /**
   * Checks if the player's units are stronger at a specific position compared to enemy units.
   * @param {World} world - The current game world state.
   * @param {Point2D} position - The position to check.
   * @returns {boolean} - Returns true if the player's units are stronger at the given position, otherwise false.
   */
  isStrongerAtPosition(world, position) {
    const { units } = world.resources.get();

    /**
     * Retrieves units within a specified radius from a position.
     * @param {Unit[]} unitArray - Array of units.
     * @param {number} rad - Radius to filter units by.
     * @returns {Unit[]} - Units within the specified radius.
     */
    const getUnitsInRadius = (unitArray, rad) =>
      unitArray.filter(unit => unit.pos && getDistance(unit.pos, position) < rad);

    let enemyUnits = getUnitsInRadius(mappedEnemyUnits, 16).filter(potentialCombatants);

    // If there's only one enemy and it's a non-combatant worker, disregard it
    if (enemyUnits.length === 1 && !potentialCombatants(enemyUnits[0])) {
      enemyUnits = [];
    }

    // If no potential enemy combatants, player is stronger by default
    if (!enemyUnits.length) return true;

    const selfUnits = getUnitsInRadius(units.getAlive(Alliance.SELF), 16).filter(potentialCombatants);
    return gameStrategyUtils.shouldEngage(world, selfUnits, enemyUnits);
  },

  /**
   * Determines if a group of selfUnits should engage against a group of enemyUnits.
   * @param {World} world
   * @param {Unit[]} selfUnits
   * @param {Unit[]} enemyUnits
   * @returns {boolean}
   */
  shouldEngage(world, selfUnits, enemyUnits) {
    if (selfUnits.length === 0 && enemyUnits.length === 0) {
      return true;  // Modify as per your game's logic
    }

    const { timeToKill, timeToBeKilled } = gameStrategyUtils.calculateCombatTimes(world, selfUnits, enemyUnits, getWeaponDPS);

    // Engage if self units can eliminate enemy units faster than they can be eliminated
    return timeToKill <= timeToBeKilled;
  }
};

module.exports = gameStrategyUtils;
