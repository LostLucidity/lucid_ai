const { loadBuildOrdersFromDirectory } = require("./buildOrderUtils");

const protossBuildOrders = loadBuildOrdersFromDirectory('protoss');
const terranBuildOrders = loadBuildOrdersFromDirectory('terran');
const zergBuildOrders = loadBuildOrdersFromDirectory('zerg');

/** @type {import('utils/globalTypes').BuildOrders} */
const buildOrders = {
  protoss: protossBuildOrders,
  terran: terranBuildOrders,
  zerg: zergBuildOrders,
};

module.exports = buildOrders;