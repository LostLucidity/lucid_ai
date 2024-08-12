// src/index.js
const core = require('./core');
const features = require('./features');
const initialization = require('./initialization');
const ConstructionSpatialService = require('./services/ConstructionSpatialService');
const gameState = require('./state');
const units = require('./units');

module.exports = {
  core,
  features,
  gameState,
  initialization,
  services: ConstructionSpatialService,
  units
};
