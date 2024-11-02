// src/features/strategy/index.js

// Exporting strategy action modules
const specialActions = require('./specialActions');
// Exporting strategy data modules
const strategyContext = require('./strategyContext');
const strategyData = require('./strategyData');
// Exporting strategy utility modules
const strategyManager = require('./strategyManager');
const unitActionStrategy = require('./unitActionStrategy');
const upgradeActionStrategy = require('./upgradeActionStrategy');
const strategyInitialization = require('../../state/strategySetup.js');
const actionStrategy = require('../actions/actionStrategy');
const unitSelection = require('../actions/unitSelection');

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
