const actionCollector = require('./actions/actionCollector');
const buildOrders = require('./buildOrders');
const construction = require('./construction');
const misc = require('./misc');
const strategy = require('./strategy');

module.exports = {
  actions: actionCollector,
  buildOrders,
  construction,
  misc,
  strategy,
};