// src/index.js
const core = require('./core');
const features = require('./features');
const gameLogic = require('./gameLogic');
const gameState = require('./gameState');
const initialization = require('./initialization');
const ConstructionSpatialService = require('./services/ConstructionSpatialService');
const units = require('./units');

module.exports = {
  core,
  features,
  gameLogic,
  gameState,
  initialization,
  services: ConstructionSpatialService,
  units
};
