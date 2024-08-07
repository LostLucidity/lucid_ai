const actionCollector = require('./actions/actionCollector');
const construction = require('./construction');
const strategy = require('./strategy');
const buildOrders = require('../../data/buildOrders');
const misc = require('../../data/gameData');

module.exports = {
  actions: actionCollector,
  buildOrders,
  construction,
  misc,
  strategy,
};