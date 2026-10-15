"use strict";

const fs = require("fs").promises;
const path = require("path");

const RACES = Object.freeze(["protoss", "terran", "zerg"]);
const DEFAULT_BUILD_ORDER_ROOT = path.join(__dirname, "..", "data", "buildOrders");

async function inspectRaceLoadability(buildOrderRoot, race) {
  const directory = path.join(buildOrderRoot, race);
  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { race, directory, status: "missing", assets: [] };
    }
    throw error;
  }

  const assetFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(entry => entry.name)
    .sort();

  if (assetFiles.length === 0) {
    return { race, directory, status: "empty", assets: [] };
  }

  const assets = assetFiles.map(fileName => {
    const filePath = path.join(directory, fileName);
    try {
      require(filePath);
      return { fileName, filePath, status: "loaded" };
    } catch (error) {
      return {
        fileName,
        filePath,
        status: "load_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return {
    race,
    directory,
    status: assets.some(asset => asset.status === "load_error") ? "load_error" : "ready",
    assets,
  };
}

async function verifyRuntimeBuildOrderLoadability(buildOrderRoot = DEFAULT_BUILD_ORDER_ROOT) {
  const races = await Promise.all(RACES.map(race => inspectRaceLoadability(buildOrderRoot, race)));
  const assets = races.flatMap(race => race.assets);
  const loadFailures = assets.filter(asset => asset.status === "load_error");
  const unavailableRaces = races.filter(race => race.status !== "ready");

  return {
    mode: "read_only_runtime_build_order_loadability",
    buildOrderRoot,
    summary: {
      requiredRaceDirectories: RACES.length,
      readyRaceDirectories: races.length - unavailableRaces.length,
      unavailableRaceDirectories: unavailableRaces.length,
      discoveredAssetFiles: assets.length,
      loadedAssetFiles: assets.length - loadFailures.length,
      loadFailures: loadFailures.length,
      ready: unavailableRaces.length === 0 && loadFailures.length === 0,
      canonicalWrites: 0,
      generatedWrites: 0,
    },
    races,
  };
}

if (require.main === module) {
  verifyRuntimeBuildOrderLoadability()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`Runtime build-order loadability check failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { verifyRuntimeBuildOrderLoadability };
