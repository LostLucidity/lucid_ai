//@ts-check
"use strict"

const loggingService = {
  getStringNameOfConstant(constants, value) {
    return `${Object.keys(constants).find(constant => constants[constant] === value)}`;
  }
}

module.exports = loggingService;