//@ts-check
"use strict"

const { findSupplyPositions } = require('./helper')

const plans = {
  economicStalkerColossi: [
    ['build', 'PYLON', 0, 14, [...findSupplyPositions()]]
  ],
}