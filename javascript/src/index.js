// src/index.js
const core = require('./core');
const features = require('./features');
const ConstructionSpatialService = require('./services/ConstructionSpatialService');
const gameState = require('./state');
const units = require('./units');

module.exports = {
  core,
  features,
  gameState,
  services: ConstructionSpatialService,
  units
};
