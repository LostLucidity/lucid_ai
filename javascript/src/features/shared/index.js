/**
 * @file index.js
 * @description This file exports all utility functions and modules in the shared directory.
 */

const buildingUtils = require('./buildingUtils');
const coreUtils = require('./coreUtils');
const mapAnalysis = require('./mapAnalysis');
const pathfinding = require('./pathfinding');
const pathfindingCommon = require('./pathfindingCommon');
const pathfindingCore = require('./pathfindingCore');
const protossUtils = require('./protossUtils');
const scoutActions = require('./scoutActions');
const scoutingUtils = require('./scoutingUtils');
const scoutManager = require('./scoutManager');
const singletonFactory = require('./singletonFactory');
const spatialCore = require('./spatialCore');
const spatialCoreUtils = require('./spatialCoreUtils');
const spatialUtils = require('./spatialUtils');
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
