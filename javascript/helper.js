//@ts-check
"use strict"

const { Alliance } = require('@node-sc2/core/constants/enums');

const helper = {
  getLoadedSupply: (units) => {
    return units.getAlive(Alliance.SELF).reduce((accumulator, currentValue) => accumulator + currentValue.cargoSpaceTaken, 0);
  },
}

module.exports = helper;