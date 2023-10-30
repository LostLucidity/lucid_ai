//@ts-check
"use strict";

const { UnitType } = require("@node-sc2/core/constants");
const { Attribute, Race } = require("@node-sc2/core/constants/enums");
const { getFoodUsed } = require("../shared-utilities/info-utils");
const planService = require("../../../services/plan-service");
const armyManagementService = require("../army-management/army-management-service");
const unitRetrievalService = require("../unit-retrieval");

const loggingService = {
  /** @type {(string | number | boolean | undefined)[][]} */
  creepTumorSteps: [],
  /** @type {(string | number | boolean | undefined)[][]} */
  creepTumorQueenSteps: [],
  /** @type {(string | number | boolean | undefined)[][]} */
  executedSteps: [],

  logoutStepsExecuted: function () {
    this.executedSteps.forEach(step => console.log(JSON.stringify(step)));
  },

  formatToMinutesAndSeconds: function (time) {
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    return `${minutes}:${this.str_pad_left(seconds, '0', 2)}`;
  },

  str_pad_left: function (string, pad, length) {
    return (new Array(length + 1).join(pad) + string).slice(-length);
  },

  /**
   * Logs the execution steps.
   *
   * @param {World} world
   * @param {number} time 
   * @param {string} name 
   * @param {string | Point2D} notes 
   */
  setAndLogExecutedSteps: function (world, time, name, notes = '') {
    const { agent, data } = world;
    const { minerals, vespene } = agent;
    const { CREEPTUMOR, CREEPTUMORQUEEN } = UnitType;
    let isStructure = false;
    if (UnitType[name]) {
      const { attributes } = data.getUnitTypeData(UnitType[name]); if (attributes === undefined) return;
      isStructure = attributes.includes(Attribute.STRUCTURE);
    }
    const foodUsed = getFoodUsed();
    const foodCount = (isStructure && agent.race === Race.ZERG) ? foodUsed + 1 : foodUsed;
    const buildStepExecuted = [foodCount, this.formatToMinutesAndSeconds(time), name, planService.currentStep, armyManagementService.outpowered, `${minerals}/${vespene}`];
    const count = UnitType[name] ? unitRetrievalService.getUnitCount(world, UnitType[name]) : 0;
    if (count) buildStepExecuted.push(count);
    if (notes) buildStepExecuted.push(notes);
    console.log(buildStepExecuted);
    if ([CREEPTUMOR, CREEPTUMORQUEEN].includes(UnitType[name])) {
      const { creepTumorSteps, creepTumorQueenSteps } = loggingService;
      if (CREEPTUMORQUEEN === UnitType[name]) {
        if (findMatchingStep(creepTumorQueenSteps, buildStepExecuted, isStructure)) {
          loggingService.creepTumorQueenSteps.splice(creepTumorQueenSteps.length - 1, 1, buildStepExecuted)
        } else {
          loggingService.creepTumorQueenSteps.push(buildStepExecuted);
        }
      } else if (CREEPTUMOR === UnitType[name]) {
        if (findMatchingStep(creepTumorSteps, buildStepExecuted, isStructure)) {
          loggingService.creepTumorSteps.splice(creepTumorSteps.length - 1, 1, buildStepExecuted)
        } else {
          loggingService.creepTumorSteps.push(buildStepExecuted);
        }
      }
    } else {
      const { executedSteps } = loggingService;
      if (findMatchingStep(executedSteps, buildStepExecuted, isStructure)) {
        loggingService.executedSteps.splice(executedSteps.length - 1, 1, buildStepExecuted)
      } else {
        loggingService.executedSteps.push(buildStepExecuted);
      }
    }
  },

  /**
   * 
   * @param {World} world 
   * @param {Unit} unit 
  */  
  logActionIfNearPosition: function (world, unit) {
    const { resources } = world;
    const { frame } = resources.get();
    const { pos, unitType } = unit;
    if (pos === undefined || unitType === undefined) {
      return;
    }
    this.setAndLogExecutedSteps(world, frame.timeInSeconds(), UnitType[unitType], pos);
  }
};

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

module.exports = loggingService;
