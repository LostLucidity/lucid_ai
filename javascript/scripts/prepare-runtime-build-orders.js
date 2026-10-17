"use strict";

const path = require("path");

const {
  verifyRuntimeBuildOrderAssets,
} = require("./verify-runtime-build-order-assets");
const {
  verifyRuntimeBuildOrderPublicLoader,
} = require("./verify-runtime-build-order-public-loader");
const {
  generateBuildOrderFiles,
} = require("../data/buildOrders/scripts/buildOrderUtils");

const DEFAULT_BUILD_ORDER_ROOT = path.join(__dirname, "..", "data", "buildOrders");
const DEFAULT_CANONICAL_SOURCE = path.join(
  DEFAULT_BUILD_ORDER_ROOT,
  "scripts",
  "scrapedBuildOrders.json"
);

async function prepareRuntimeBuildOrders(
  outputRoot = DEFAULT_BUILD_ORDER_ROOT,
  canonicalSourcePath = DEFAULT_CANONICAL_SOURCE
) {
  const generatedByRace = await generateBuildOrderFiles(canonicalSourcePath, outputRoot);
  const [assetContract, publicLoader] = await Promise.all([
    verifyRuntimeBuildOrderAssets(outputRoot, canonicalSourcePath),
    verifyRuntimeBuildOrderPublicLoader(outputRoot),
  ]);
  const generatedAssets = Object.values(generatedByRace)
    .reduce((total, count) => total + count, 0);

  if (!assetContract.summary.ready || !publicLoader.summary.ready) {
    throw new Error("Generated runtime build-order assets failed verification");
  }

  return {
    mode: "prepare_runtime_build_orders",
    outputRoot,
    canonicalSourcePath,
    summary: {
      generatedAssets,
      generatedByRace,
      canonicalBuildOrders: assetContract.summary.canonicalBuildOrders,
      matchedBuildOrders: assetContract.summary.matchedBuildOrders,
      loadedBuildOrders: publicLoader.summary.loadedBuildOrders,
      ready: true,
      canonicalWrites: 0,
      generatedWrites: generatedAssets,
    },
  };
}

if (require.main === module) {
  prepareRuntimeBuildOrders()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`Runtime build-order preparation failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { prepareRuntimeBuildOrders };
