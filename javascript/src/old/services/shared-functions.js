//@ts-check
"use strict"

// shared-functions.js

const { WorkerRace } = require("@node-sc2/core/constants/race-map");
const { UnitType } = require("@node-sc2/core/constants");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { formatToMinutesAndSeconds } = require("./../shared-utilities/logging-utils");
const planService = require("../../services/plan-service");
const unitRetrievalService = require("./unit-retrieval");
const { getFoodUsed } = require("../shared-utilities/info-utils");

/**
 * @param {(string | number | boolean | undefined)[][]} steps
 * @param {(string | number | boolean | undefined)[]} buildStepExecuted
 * @param {boolean} isStructure
 * @returns {boolean}
 */
function findMatchingStep(steps, buildStepExecuted, isStructure) {
  const lastElement = steps.length - 1;
  const lastStep = steps[lastElement];
  let foundMatchingStep = false;
  if (lastStep) {
    foundMatchingStep = buildStepExecuted[2] === lastStep[2] && buildStepExecuted[6] === lastStep[6];
    if (foundMatchingStep && !isStructure) {
      foundMatchingStep = foundMatchingStep && buildStepExecuted[3] === lastStep[3];
    }
  }
  return foundMatchingStep
}

/**
 * Logs the execution steps in a more decoupled manner.
 *
 * @param {World} world
 * @param {number} time 
 * @param {string} name 
 * @param {import("../interfaces/i-logging-service").ILoggingService} loggingService The logging service to be used.
 * @param {import("../interfaces/i-army-management-service-minimal").IArmyManagementServiceMinimal} armyManagementServiceMinimal The army management service to be used.
 * @param {string | Point2D} [notes=''] 
 * @param {string} [message=''] Optional message to be logged.
 */
function setAndLogExecutedSteps(world, time, name, loggingService, armyManagementServiceMinimal, notes = '', message = '') {
  const { agent, data } = world;
  const { minerals, vespene } = agent;
  const { CREEPTUMOR, CREEPTUMORQUEEN } = UnitType;
  let isStructure = false;

  if (UnitType[name]) {
    const { attributes } = data.getUnitTypeData(UnitType[name]);
    if (attributes === undefined) return;
    isStructure = attributes.includes(Attribute.STRUCTURE);
  }

  const foodUsed = getFoodUsed();
  const foodCount = (isStructure && agent.race === Race.ZERG) ? foodUsed + 1 : foodUsed;
  const buildStepExecuted = [foodCount, formatToMinutesAndSeconds(time), name, planService.currentStep, armyManagementServiceMinimal.getOutpoweredStatus(), `${minerals}/${vespene}`];

  const count = UnitType[name] ? unitRetrievalService.getUnitCount(world, UnitType[name]) : 0;

  if (count) {
    buildStepExecuted.push(count);
  }

  if (notes) {
    if (typeof notes === "string") {
      buildStepExecuted.push(notes);
    } else {
      // Assuming Point2D has x and y properties
      buildStepExecuted.push(`(${notes.x}, ${notes.y})`);
    }
  }

  if (message) {
    console.log(message);
    buildStepExecuted.push(message);
  }

  console.log(buildStepExecuted);

  if ([CREEPTUMOR, CREEPTUMORQUEEN].includes(UnitType[name])) {
    const { creepTumorSteps, creepTumorQueenSteps } = loggingService;

    if (CREEPTUMORQUEEN === UnitType[name]) {
      if (findMatchingStep(creepTumorQueenSteps, buildStepExecuted, isStructure)) {
        loggingService.creepTumorQueenSteps.splice(creepTumorQueenSteps.length - 1, 1, buildStepExecuted);
      } else {
        loggingService.creepTumorQueenSteps.push(buildStepExecuted);
      }
    } else if (CREEPTUMOR === UnitType[name]) {
      if (findMatchingStep(creepTumorSteps, buildStepExecuted, isStructure)) {
        loggingService.creepTumorSteps.splice(creepTumorSteps.length - 1, 1, buildStepExecuted);
      } else {
        loggingService.creepTumorSteps.push(buildStepExecuted);
      }
    }
  } else {
    const { executedSteps } = loggingService;

    if (findMatchingStep(executedSteps, buildStepExecuted, isStructure)) {
      loggingService.executedSteps.splice(executedSteps.length - 1, 1, buildStepExecuted);
    } else {
      loggingService.executedSteps.push(buildStepExecuted);
    }
  }
}

// Export the functions
module.exports = {
  setAndLogExecutedSteps,
};