// @ts-check
"use strict";

/**
 * @typedef {Object} ILoggingService
 * @property {(string | number | boolean | undefined)[][]} creepTumorSteps
 * @property {(string | number | boolean | undefined)[][]} creepTumorQueenSteps
 * @property {(string | number | boolean | undefined)[][]} executedSteps
 * @property {function(World, Unit, string): void} logActionIfNearPosition Logs an action if the unit is near a position.
 * @property {function(string, string): void} logMessage Logs a general message to the console.
 * @property {function(): void} logoutStepsExecuted Logs the executed steps.
 * @property {function(Unit, Point2D[], Point2D): void} logPathfindingIssue Logs potential issues related to pathfinding.
 * @property {function(Unit, string): void} logRetreatAction Logs a potential threat.
 */
module.exports = {};