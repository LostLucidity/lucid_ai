// src/gameLogic/index.js
const buildingUtils = require('./buildingUtils');
const coreUtils = require('./coreUtils');
const economy = require("./economy");
const gameMechanics = require("./gameMechanics");
const mapAnalysis = require('./mapAnalysis');
const pathfinding = require('./pathfinding');
const pathfindingCommon = require('./pathfindingCommon');
const protossUtils = require('./protossUtils');
const scoutActions = require("./scoutActions");
const scoutingUtils = require("./scoutingUtils");
const scoutManager = require("./scoutManager");
const shared = require("./shared");
const singletonFactory = require('./singletonFactory');
const spatialCore = require('./spatialCore');
const spatialCoreUtils = require('./spatialCoreUtils');
const spatialUtils = require('./spatialUtils');
const stateManagement = require('./stateManagement');
const workerCommonUtils = require('./workerCommonUtils');

module.exports = {
  building: buildingUtils,
  coreUtils,
  economy,
  gameMechanics,
  mapAnalysis,
  pathfinding,
  pathfindingCommon,
  protossUtils,
  resources: stateManagement,
  scoutActions,
  scoutingUtils,
  scoutManager,
  shared,
  singletonFactory,
  spatial: spatialCore,
  spatialCoreUtils,
  spatialUtils,
  workerCommonUtils,
};
