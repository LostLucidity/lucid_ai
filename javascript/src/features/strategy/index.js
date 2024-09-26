// src/features/strategy/index.js

// Exporting strategy action modules
const actionStrategy = require('./actionStrategy');
const specialActions = require('./specialActions');
// Exporting strategy data modules
const strategyContext = require('./strategyContext');
const strategyData = require('./strategyData');
// Exporting strategy utility modules
const strategyManager = require('./strategyManager');
const unitActionStrategy = require('./unitActionStrategy');
const unitSelection = require('./unitSelection');
const upgradeActionStrategy = require('./upgradeActionStrategy');
const strategyInitialization = require('../../state/strategySetup.js');

// Aggregating and exporting all modules
module.exports = {
  specialActions,
  strategyData,
  actionStrategy,
  strategyContext,
  strategyInitialization,
  strategyManager,
  unitActionStrategy,
  unitSelection,
  upgradeActionStrategy
};
