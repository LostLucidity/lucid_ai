//@ts-check
"use strict"

const { Race } = require("@node-sc2/core/constants/enums");
const fs = require('fs');
const path = require("path");

module.exports = {
  getRace: (data, unitType) => {
    return Object.keys(Race).find(race => Race[race] === data.getUnitTypeData(parseInt(unitType)).race);
  },
  getFileName: (data, selfUnitType, enemyUnitType) => {
    const selfRace = module.exports.getRace(data, selfUnitType);
    const enemyRace = module.exports.getRace(data, enemyUnitType);
    return `${selfRace}vs${enemyRace}.json`;
  },
}