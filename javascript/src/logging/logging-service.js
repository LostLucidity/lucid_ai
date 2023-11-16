//@ts-check
"use strict";

const { UnitType } = require("@node-sc2/core/constants");
const { setAndLogExecutedSteps } = require("../services/shared-functions");

class LoggingService {
  /**
   * @param {import("../interfaces/i-army-management-service-minimal").IArmyManagementServiceMinimal} armyManagementServiceMinimal
   */
  constructor(armyManagementServiceMinimal) {
    this.armyManagementServiceMinimal = armyManagementServiceMinimal;
  }
  /** @type {(string | number | boolean | undefined)[][]} */
  creepTumorSteps = [];
  /** @type {(string | number | boolean | undefined)[][]} */
  creepTumorQueenSteps = [];
  /** @type {(string | number | boolean | undefined)[][]} */
  executedSteps = [];

  /**
   * 
   * @param {World} world 
   * @param {Unit} unit 
   * @param {string} message 
   */
  logActionIfNearPosition(world, unit, message) {
    const { resources } = world;
    const { frame } = resources.get();
    const { pos, unitType } = unit;

    if (pos === undefined || unitType === undefined) {
      return;
    }

    // Assuming `setAndLogExecutedSteps` takes in the message as an argument.
    setAndLogExecutedSteps(world, frame.timeInSeconds(), UnitType[unitType], this, this.armyManagementServiceMinimal, pos, message);
  }

  /**
   * Logs a general message to the console.
   * 
   * @param {string} message - The message to log.
   * @param {string} [type='info'] - The type of log. Default is 'info'. Other possible values: 'warn', 'error', etc.
   */
  logMessage(message, type = 'info') {
    console[type](message);
  }  

  /**
   * Logs the executed steps.
   */
  logoutStepsExecuted() {
    this.executedSteps.forEach(step => {
      this.logMessage(`Step executed: ${JSON.stringify(step)}`);
    });
  }

  /**
 * Logs potential issues related to pathfinding.
 * 
 * @param {Unit} unit - The unit in context.
 * @param {Point2D[]} targetPositions - The positions of target units/threats.
 * @param {Point2D} resultPosition - The resulting position after pathfinding.
 */
  logPathfindingIssue(unit, targetPositions, resultPosition) {
    this.logMessage(`[Pathfinding] Unit ${unit.tag} tried retreating from threats at ${JSON.stringify(targetPositions)} but ended at a potentially unpathable position ${JSON.stringify(resultPosition)}`, 'warn');
  }

  /**
   * Logs when a unit starts its retreat action.
   * 
   * @param {Unit} unit - The unit in context.
   * @param {string} reason - The reason for the retreat.
   */
  logRetreatAction(unit, reason) {
    this.logMessage(`[Retreat] Unit ${unit.tag} is retreating due to: ${reason}`);
  }
}

module.exports = LoggingService;
