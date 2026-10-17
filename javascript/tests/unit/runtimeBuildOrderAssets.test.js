const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const {
  verifyRuntimeBuildOrderAssets,
} = require("../../scripts/verify-runtime-build-order-assets");

describe("runtime build-order asset contract", () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lucid-runtime-assets-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reports missing and empty race directories without writing", async () => {
    await fs.mkdir(path.join(root, "protoss"));
    await fs.mkdir(path.join(root, "terran"));
    await fs.writeFile(path.join(root, "terran", "build.js"), "module.exports = {};\n");

    const report = await verifyRuntimeBuildOrderAssets(root);

    expect(report.summary).toEqual({
      requiredRaceDirectories: 3,
      readyRaceDirectories: 1,
      missingOrEmptyRaceDirectories: 2,
      semanticFidelityChecked: false,
      canonicalBuildOrders: 0,
      matchedBuildOrders: 0,
      missingRuntimeAssets: 0,
      semanticMismatches: 0,
      loadErrors: 0,
      ready: false,
      canonicalWrites: 0,
      generatedWrites: 0,
    });
    expect(report.races.map(race => [race.race, race.status])).toEqual([
      ["protoss", "empty"],
      ["terran", "ready"],
      ["zerg", "missing"],
    ]);
  });

  it("reports canonical-to-runtime interpreted-action drift without writing", async () => {
    const sourcePath = path.join(root, "source.json");
    const canonical = [{
      title: "Warp Gate fixture",
      raceMatchup: "PvX",
      steps: [{
        action: "Warp Gate",
        interpretedAction: [{ unitType: null, upgradeType: 84, count: 1, isUpgrade: true }],
      }],
    }];
    await fs.writeFile(sourcePath, JSON.stringify(canonical), "utf8");
    for (const race of ["protoss", "terran", "zerg"]) {
      await fs.mkdir(path.join(root, race));
      await fs.writeFile(
        path.join(root, race, race === "protoss" ? "warp_gate_fixture.js" : "placeholder.js"),
        race === "protoss"
          ? "module.exports = { steps: [{ interpretedAction: [{ unitType: 133, upgradeType: null, count: 1, isUpgrade: false }] }] };\n"
          : "module.exports = {};\n",
        "utf8"
      );
    }

    const report = await verifyRuntimeBuildOrderAssets(root, sourcePath);

    expect(report.summary.ready).toBe(false);
    expect(report.summary.semanticFidelityChecked).toBe(true);
    expect(report.summary.canonicalBuildOrders).toBe(1);
    expect(report.summary.matchedBuildOrders).toBe(0);
    expect(report.summary.semanticMismatches).toBe(1);
    expect(report.semanticFidelity.semanticMismatches[0]).toMatchObject({
      title: "Warp Gate fixture",
      stepIndex: 0,
      action: "Warp Gate",
      reason: "interpreted_action_mismatch",
    });
  });

  it("confirms the current production root has all required race assets", async () => {
    const report = await verifyRuntimeBuildOrderAssets();

    expect(report.summary.ready).toBe(true);
    expect(report.summary.semanticFidelityChecked).toBe(true);
    expect(report.summary.canonicalBuildOrders).toBe(60);
    expect(report.summary.matchedBuildOrders).toBe(60);
    expect(report.summary.semanticMismatches).toBe(0);
    expect(report.summary.canonicalWrites).toBe(0);
    expect(report.races.every(race => race.assetFiles.length > 0)).toBe(true);
  });
});
