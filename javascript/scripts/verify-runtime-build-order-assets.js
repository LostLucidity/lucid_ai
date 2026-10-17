"use strict";

const fs = require("fs").promises;
const path = require("path");
const { isDeepStrictEqual } = require("util");

const {
  determineRaceDirectory,
  sanitizeFileName,
} = require("../data/buildOrders/scripts/buildOrderUtils");

const RACES = Object.freeze(["protoss", "terran", "zerg"]);
const DEFAULT_BUILD_ORDER_ROOT = path.join(__dirname, "..", "data", "buildOrders");
const DEFAULT_CANONICAL_SOURCE = path.join(
  DEFAULT_BUILD_ORDER_ROOT,
  "scripts",
  "scrapedBuildOrders.json"
);

async function inspectRaceDirectory(buildOrderRoot, race) {
  const directory = path.join(buildOrderRoot, race);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const assetFiles = entries
      .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
      .map(entry => entry.name)
      .sort();
    return {
      race,
      directory,
      status: assetFiles.length > 0 ? "ready" : "empty",
      assetFiles,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { race, directory, status: "missing", assetFiles: [] };
    }
    throw error;
  }
}

function loadRuntimeBuildOrder(filePath) {
  const resolvedPath = require.resolve(filePath);
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

async function inspectSemanticFidelity(buildOrderRoot, canonicalSourcePath) {
  if (!canonicalSourcePath) {
    return {
      checked: false,
      canonicalBuildOrders: 0,
      matchedBuildOrders: 0,
      missingRuntimeAssets: [],
      semanticMismatches: [],
      loadErrors: [],
    };
  }

  const canonicalBuildOrders = JSON.parse(await fs.readFile(canonicalSourcePath, "utf8"));
  const missingRuntimeAssets = [];
  const semanticMismatches = [];
  const loadErrors = [];
  let matchedBuildOrders = 0;

  for (const canonical of canonicalBuildOrders) {
    const race = determineRaceDirectory(canonical.raceMatchup);
    const fileName = `${sanitizeFileName(canonical.title)}.js`;
    const filePath = path.join(buildOrderRoot, race || "unknown", fileName);
    let runtime;

    try {
      await fs.access(filePath);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        missingRuntimeAssets.push({ title: canonical.title, race, fileName });
        continue;
      }
      throw error;
    }

    try {
      runtime = loadRuntimeBuildOrder(filePath);
    } catch (error) {
      loadErrors.push({
        title: canonical.title,
        race,
        fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const canonicalSteps = Array.isArray(canonical.steps) ? canonical.steps : [];
    const runtimeSteps = Array.isArray(runtime.steps) ? runtime.steps : [];
    let matches = canonicalSteps.length === runtimeSteps.length;

    if (!matches) {
      semanticMismatches.push({
        title: canonical.title,
        race,
        fileName,
        stepIndex: null,
        action: null,
        reason: "step_count_mismatch",
        canonicalStepCount: canonicalSteps.length,
        runtimeStepCount: runtimeSteps.length,
      });
    }

    const comparedStepCount = Math.min(canonicalSteps.length, runtimeSteps.length);
    for (let stepIndex = 0; stepIndex < comparedStepCount; stepIndex += 1) {
      const canonicalSemantics = canonicalSteps[stepIndex].interpretedAction;
      const runtimeSemantics = runtimeSteps[stepIndex].interpretedAction;
      if (!isDeepStrictEqual(canonicalSemantics, runtimeSemantics)) {
        matches = false;
        semanticMismatches.push({
          title: canonical.title,
          race,
          fileName,
          stepIndex,
          action: canonicalSteps[stepIndex].action || null,
          reason: "interpreted_action_mismatch",
          canonical: canonicalSemantics,
          runtime: runtimeSemantics,
        });
      }
    }

    if (matches) {
      matchedBuildOrders += 1;
    }
  }

  return {
    checked: true,
    canonicalBuildOrders: canonicalBuildOrders.length,
    matchedBuildOrders,
    missingRuntimeAssets,
    semanticMismatches,
    loadErrors,
  };
}

async function verifyRuntimeBuildOrderAssets(
  buildOrderRoot = DEFAULT_BUILD_ORDER_ROOT,
  canonicalSourcePath = path.resolve(buildOrderRoot) === path.resolve(DEFAULT_BUILD_ORDER_ROOT)
    ? DEFAULT_CANONICAL_SOURCE
    : null
) {
  const races = await Promise.all(RACES.map(race => inspectRaceDirectory(buildOrderRoot, race)));
  const missingOrEmpty = races.filter(race => race.status !== "ready");
  const semanticFidelity = await inspectSemanticFidelity(buildOrderRoot, canonicalSourcePath);
  const semanticFailures = semanticFidelity.missingRuntimeAssets.length
    + semanticFidelity.semanticMismatches.length
    + semanticFidelity.loadErrors.length;

  return {
    mode: "read_only_runtime_build_order_asset_contract",
    buildOrderRoot,
    summary: {
      requiredRaceDirectories: RACES.length,
      readyRaceDirectories: races.length - missingOrEmpty.length,
      missingOrEmptyRaceDirectories: missingOrEmpty.length,
      semanticFidelityChecked: semanticFidelity.checked,
      canonicalBuildOrders: semanticFidelity.canonicalBuildOrders,
      matchedBuildOrders: semanticFidelity.matchedBuildOrders,
      missingRuntimeAssets: semanticFidelity.missingRuntimeAssets.length,
      semanticMismatches: semanticFidelity.semanticMismatches.length,
      loadErrors: semanticFidelity.loadErrors.length,
      ready: missingOrEmpty.length === 0 && semanticFailures === 0,
      canonicalWrites: 0,
      generatedWrites: 0,
    },
    races,
    semanticFidelity,
  };
}

if (require.main === module) {
  verifyRuntimeBuildOrderAssets()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`Runtime build-order asset contract failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  inspectSemanticFidelity,
  verifyRuntimeBuildOrderAssets,
};
