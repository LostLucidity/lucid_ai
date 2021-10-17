//@ts-check
"use strict"

const { UnitTypeId } = require("@node-sc2/core/constants");
const { distance } = require("@node-sc2/core/utils/geometry/point");
const scoutService = require("../systems/scouting/scouting-service");

const loggingService = {
  executedSteps: [],
  getStringNameOfConstant(constants, value) {
    return `${Object.keys(constants).find(constant => constants[constant] === value)}`;
  },
  /**
   * 
   * @param {World} world 
   * @param {Unit} unit 
   * @param {Point2D} targetPosition 
   * @param {number} unitType 
   */
  logActionIfNearPosition: (world, unitType, unit, targetPosition) => {
    const { agent, resources } = world;
    if (distance(unit.pos, targetPosition) < 4) {
      const note = `Distance to position: ${distance(unit.pos, targetPosition)}`;
      console.log('note');
      loggingService.setAndLogExecutedSteps(agent, resources.get().frame.timeInSeconds(), UnitTypeId[unitType], note);
    }
  },
  logoutStepsExecuted: () => {
    loggingService.executedSteps.forEach(step => console.log(step));
  },
  /**
   * 
   * @param {World["agent"]} param0
   * @param {number} time 
   * @param {string} name 
   * @param {string} extra 
   */
  setAndLogExecutedSteps: (agent, time, name, extra = '') => {
    const { foodUsed, minerals, vespene } = agent;
    const buildStepExecuted = [foodUsed, loggingService.formatToMinutesAndSeconds(time), name, scoutService.outsupplied, `${minerals}/${vespene}`];
    if (extra) buildStepExecuted.push(extra);
    console.log(buildStepExecuted);
    loggingService.executedSteps.push(buildStepExecuted);
  },

  formatToMinutesAndSeconds: (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    const { str_pad_left } = loggingService;
    return `${minutes}:${str_pad_left(seconds, '0', 2)}`;
  },
  str_pad_left: (string, pad, length) => {
    return (new Array(length + 1).join(pad) + string).slice(-length);
  }
}

module.exports = loggingService;
