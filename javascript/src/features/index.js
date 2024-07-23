const actionCollector = require('./actions/actionCollector');
const buildOrders = require('./buildOrders');
const construction = require('./construction');
const misc = require('./gameData');
const strategy = require('./strategy');

module.exports = {
  actions: actionCollector,
  buildOrders,
  construction,
  misc,
  strategy,
};