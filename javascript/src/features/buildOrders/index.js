const { loadBuildOrdersFromDirectory } = require("./buildOrderUtils");

const protossBuildOrders = loadBuildOrdersFromDirectory('protoss');
const terranBuildOrders = loadBuildOrdersFromDirectory('terran');
const zergBuildOrders = loadBuildOrdersFromDirectory('zerg');

/** @type {import('../../utils/common/globalTypes').BuildOrders} */
const buildOrders = {
  protoss: protossBuildOrders,
  terran: terranBuildOrders,
  zerg: zergBuildOrders,
};

module.exports = buildOrders;