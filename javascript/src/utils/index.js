// src/utils/index.js

// Import all utility modules
const addonUtils = require('./addonUtils');
const builderUtils = require('./builderUtils');
const cache = require('./cache');
const common = require('./common');
const commonUnitUtils = require('./commonUnitUtils');
const constants = require('./constants');
const constructionDataUtils = require('./constructionDataUtils');
const generalUtils = require('./generalUtils');
const globalTypes = require('./globalTypes');
const logger = require('./logger');
const logging = require('./logging');
const pathfindingUtils = require('./pathfindingUtils');
const resourceUtils = require('./resourceUtils');
const sharedPathfindingUtils = require('./sharedPathfindingUtils');
const sharedUnitPlacement = require('./sharedUnitPlacement');
const sharedUtils = require('./sharedUtils');
const strategyUtils = require('./strategyUtils');
const supplyUtils = require('./supplyUtils');
const timeUtils = require('./timeUtils');
const unitUtils = require('./unitUtils');
const workerUtils = require('./workerUtils');

// Export all utility modules
module.exports = {
  addonUtils,
  builderUtils,
  cache,
  common,
  commonUnitUtils,
  constants,
  constructionDataUtils,
  generalUtils,
  globalTypes,
  logger,
  logging,
  pathfindingUtils,
  resourceUtils,
  sharedPathfindingUtils,
  sharedUnitPlacement,
  sharedUtils,
  strategyUtils,
  supplyUtils,
  timeUtils,
  unitUtils,
  workerUtils
};
