// src/core/data/index.js

// Import specific functionalities from data handling files
const { getUnitTypeData, findUnitTypesWithAbility } = require('./gameData');

// Re-export these functionalities
module.exports = {
  getUnitTypeData,
  findUnitTypesWithAbility
};
