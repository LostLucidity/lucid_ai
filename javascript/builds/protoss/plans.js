//@ts-check
"use strict"

const { PYLON } = require('@node-sc2/core/constants/unit-type');

const plans = {
  1: {},
  2: {},
  3: {
    economicStalkerColossi: [
      [0, 'buildWorkers'],
      [14, 'build', 'PYLON', 0, 'findSupplyPositions'],
      [15, 'build', 'GATEWAY', 0]
    ],
  } 
}

module.exports = plans;