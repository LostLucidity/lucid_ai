// src/features/strategy/index.js
const actions = require('./actions');
const data = require('./data/strategyData');
const strategyContext = require('./strategyContext');
const strategyInitialization = require('./strategyInitialization');
const strategyManager = require('./strategyManager');
const strategyUtils = require('./strategyUtils');
const unitActionStrategy = require('./unitActionStrategy');
const unitSelection = require('./unitSelection');
const upgradeActionStrategy = require('./upgradeActionStrategy');
const utils = require('./utils');

module.exports = {
  actions,
  data,
  strategyContext,
  strategyInitialization,
  strategyManager,
  strategyUtils,
  unitActionStrategy,
  unitSelection,
  upgradeActionStrategy,
  utils
};
