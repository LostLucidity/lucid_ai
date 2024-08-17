const { loadBuildOrdersFromDirectory } = require("./buildOrderUtils");

/**
 * @type {{
 *   buildOrders: import('src/core/globalTypes').BuildOrders | null;
 * }}
 */
const buildOrderStore = {
  buildOrders: null, // Start with null, but it will eventually hold BuildOrders
};

/**
 * Loads all build orders.
 * @returns {Promise<import('src/core/globalTypes').BuildOrders>}
 */
async function loadAllBuildOrders() {
  const [protossBuildOrders, terranBuildOrders, zergBuildOrders] = await Promise.all([
    loadBuildOrdersFromDirectory('protoss'),
    loadBuildOrdersFromDirectory('terran'),
    loadBuildOrdersFromDirectory('zerg')
  ]);

  buildOrderStore.buildOrders = {
    protoss: protossBuildOrders,
    terran: terranBuildOrders,
    zerg: zergBuildOrders,
  };

  return buildOrderStore.buildOrders;
}

module.exports = {
  loadAllBuildOrders,
  buildOrderStore,
};
