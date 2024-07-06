/**
 * @file index.js
 * @description This file exports all utility functions and modules in the shared directory.
 */

const buildingUtils = require('./buildingUtils');
const coreUtils = require('./coreUtils');
const mapAnalysis = require('./mapAnalysis');
const pathfinding = require('./pathfinding/pathfinding');
const pathfindingCommon = require('./pathfinding/pathfindingCommon');
const pathfindingCore = require('./pathfinding/pathfindingCore');
const spatialCore = require('./pathfinding/spatialCore');
const spatialCoreUtils = require('./pathfinding/spatialCoreUtils');
const spatialUtils = require('./pathfinding/spatialUtils');
const protossUtils = require('./protossUtils');
const scoutActions = require('./scoutActions');
const scoutingUtils = require('./scoutingUtils');
const scoutManager = require('./scoutManager');
const singletonFactory = require('./singletonFactory');
const stateManagement = require('./stateManagement');
const unitPreparationUtils = require('./unitPreparationUtils');
const workerCommonUtils = require('./workerCommonUtils');
const workerManagementUtils = require('./workerManagementUtils');

module.exports = {
  unitPreparationUtils,
  buildingUtils,
  coreUtils,
  mapAnalysis,
  pathfinding,
  pathfindingCommon,
  pathfindingCore,
  protossUtils,
  scoutActions,
  scoutingUtils,
  scoutManager,
  singletonFactory,
  spatialCore,
  spatialCoreUtils,
  spatialUtils,
  stateManagement,
  workerCommonUtils,
  workerManagementUtils
};
