//@ts-check
"use strict";

const { Alliance } = require("@node-sc2/core/constants/enums");

const healthTrackingService = {
  alliedHealthDifference: {
    [Alliance.SELF]: {},
    [Alliance.ENEMY]: {},
  },
  dPSOfUnits: {
    /** @type {number[]} */
    [Alliance.SELF]: [],
    [Alliance.ENEMY]: [],
  },
  healthDifference: {
    /** @type {number[]} */
    [Alliance.SELF]: [],
    [Alliance.ENEMY]: [],
  },
  healthOfUnits: {
    [Alliance.SELF]: {},
    [Alliance.ENEMY]: {},
  },
}

module.exports = healthTrackingService;