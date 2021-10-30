//@ts-check
"use strict"

const loggingService = {
  executedSteps: [],
  getStringNameOfConstant(constants, value) {
    return `${Object.keys(constants).find(constant => constants[constant] === value)}`;
  },
  logoutStepsExecuted: () => {
    loggingService.executedSteps.forEach(step => console.log(step));
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
