// src/gameLogic/index.js
const buildingUtils = require('./building/buildingUtils');
const stateManagement = require('./resources/stateManagement');
const scouting = require('./scouting');
const spatial = require('./spatial');
const unit = require('./unit');
const utils = require('./utils');

module.exports = {
  building: buildingUtils,
  resources: stateManagement,
  scouting,
  spatial,
  unit,
  utils
};
