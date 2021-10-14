//@ts-check
"use strict"

const scoutService = require("../systems/scouting/scouting-service");
const planService = require("./plan-service");

const loggingService = {
  executedSteps: [],
  getStringNameOfConstant(constants, value) {
    return `${Object.keys(constants).find(constant => constants[constant] === value)}`;
  },
  logoutStepsExecuted: () => {
    loggingService.executedSteps.forEach(step => console.log(step));
  },
  /**
   * Unpause and log on attempted steps.
   * @param {World} world 
   * @param {string} name 
   * @param {string} extra 
   */
  unpauseAndLog: (world, name, extra='') => {
    const { agent, resources } = world;
    const { frame } = resources.get();
    planService.pausePlan = false;
    planService.continueBuild = true;
    loggingService.setAndLogExecutedSteps(agent, frame.timeInSeconds(), name, extra);
  }  ,
  /**
   * 
   * @param {World["agent"]} param0
   * @param {number} time 
   * @param {string} name 
   * @param {string} extra 
   */
  setAndLogExecutedSteps: ({foodUsed, minerals, vespene}, time, name, extra='') => {
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
