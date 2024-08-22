// Exporting core functionalities
module.exports = {
  buildUtils: require('./buildUtils'),
  earmarkManager: require('./earmarkManager'),
  gameData: require('./gameData'),
  resourceEarmarkManager: require('./resourceEarmarkManager'),

  // Exporting utilities previously in `src/utils`
  addonUtils: require('./addonUtils'),
  builderUtils: require('./builderUtils'),
  buildingUtils: require('./buildingUtils'),
  cache: require('./cache'),
  common: require('./common'),
  commonUnitUtils: require('./commonUnitUtils'),
  constants: require('./constants'),
  constructionDataUtils: require('./constructionDataUtils'),
  globalTypes: require('./globalTypes'),
  logger: require('./logger'),
  logging: require('./logging'),
  pathfindingCore: require('./pathfindingCore'),
  sharedUnitPlacement: require('./sharedUnitPlacement'),
  upgradeUtils: require('./upgradeUtils'),
};
