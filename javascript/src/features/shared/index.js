/**
 * @file index.js
 * @description This file exports all utility functions and modules in the shared directory.
 */

const buildingUtils = require('./buildingUtils');
const pathfinding = require('./pathfinding/pathfinding');
const pathfindingCommon = require('./pathfinding/pathfindingCommonUtils');
const pathfindingCore = require('./pathfinding/pathfindingCore');
const spatialCore = require('./pathfinding/spatialCore');
const protossUtils = require('./protossUtils');
const scoutActions = require('./scoutActions');
const scoutManager = require('./scoutManager');
const unitPreparationUtils = require('./unitPreparationUtils');
const workerCommonUtils = require('./workerCommonUtils');
const coreUtils = require('../../utils/coreUtils');
const mapAnalysis = require('../../utils/mapAnalysis');
const scoutingUtils = require('../../utils/scoutingUtils');
const singletonFactory = require('../../utils/singletonFactory');
const spatialUtils = require('../../utils/spatial/spatialUtils');
const spatialCoreUtils = require('../../utils/spatialCoreUtils');
const stateManagement = require('../../utils/stateManagement');
const workerManagementUtils = require('../../utils/workerManagementUtils');

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
