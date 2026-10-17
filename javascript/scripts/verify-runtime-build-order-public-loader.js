"use strict";

const { loadAllBuildOrders } = require("../data/buildOrders");

const RACES = Object.freeze(["protoss", "terran", "zerg"]);

function summarizeBuildOrderAggregate(buildOrders) {
  const races = RACES.map(race => {
    const entries = buildOrders && buildOrders[race] && typeof buildOrders[race] === "object"
      ? Object.keys(buildOrders[race]).sort()
      : [];

    return {
      race,
      loadedBuildOrders: entries.length,
      status: entries.length > 0 ? "ready" : "empty",
      buildOrderKeys: entries,
    };
  });
  const unavailableRaces = races.filter(race => race.status !== "ready");
  const loadedBuildOrders = races.reduce((total, race) => total + race.loadedBuildOrders, 0);

  return {
    mode: "read_only_runtime_build_order_public_loader",
    summary: {
      requiredRaceMaps: RACES.length,
      readyRaceMaps: races.length - unavailableRaces.length,
      unavailableRaceMaps: unavailableRaces.length,
      loadedBuildOrders,
      ready: unavailableRaces.length === 0,
      canonicalWrites: 0,
      generatedWrites: 0,
    },
    races,
  };
}

async function verifyRuntimeBuildOrderPublicLoader(buildOrderRoot) {
  const buildOrders = await loadAllBuildOrders(buildOrderRoot);
  return summarizeBuildOrderAggregate(buildOrders);
}

if (require.main === module) {
  verifyRuntimeBuildOrderPublicLoader()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`Runtime build-order public-loader check failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  summarizeBuildOrderAggregate,
  verifyRuntimeBuildOrderPublicLoader,
};
