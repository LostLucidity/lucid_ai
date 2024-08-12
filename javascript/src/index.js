// src/index.js
const core = require('./core');
const features = require('./features');
const gameState = require('./state');
const initialization = require('./initialization');
const ConstructionSpatialService = require('./services/ConstructionSpatialService');
const units = require('./units');

module.exports = {
  core,
  features,
  gameState,
  initialization,
  services: ConstructionSpatialService,
  units
};
