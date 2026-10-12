const { loadBuildOrdersFromDirectory } = require("./scripts/buildOrderUtils");

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
 * @param {string} [buildOrderRoot] Optional runtime asset root.
 * @returns {Promise<import('src/core/globalTypes').BuildOrders>}
 */
async function loadAllBuildOrders(buildOrderRoot) {
  const [protossBuildOrders, terranBuildOrders, zergBuildOrders] = await Promise.all([
    loadBuildOrdersFromDirectory('protoss', buildOrderRoot),
    loadBuildOrdersFromDirectory('terran', buildOrderRoot),
    loadBuildOrdersFromDirectory('zerg', buildOrderRoot)
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
