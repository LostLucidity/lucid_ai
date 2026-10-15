const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const {
  verifyRuntimeBuildOrderLoadability,
} = require("../../scripts/verify-runtime-build-order-loadability");

describe("runtime build-order loadability", () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lucid-runtime-loadability-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reports missing directories and individual module load failures without writing", async () => {
    await fs.mkdir(path.join(root, "protoss"));
    await fs.mkdir(path.join(root, "terran"));
    await fs.writeFile(path.join(root, "protoss", "valid.js"), "module.exports = {};\n");
    await fs.writeFile(path.join(root, "terran", "broken.js"), "module.exports = ;\n");

    const report = await verifyRuntimeBuildOrderLoadability(root);

    expect(report.summary).toEqual({
      requiredRaceDirectories: 3,
      readyRaceDirectories: 1,
      unavailableRaceDirectories: 2,
      discoveredAssetFiles: 2,
      loadedAssetFiles: 1,
      loadFailures: 1,
      ready: false,
      canonicalWrites: 0,
      generatedWrites: 0,
    });
    expect(report.races.map(race => [race.race, race.status])).toEqual([
      ["protoss", "ready"],
      ["terran", "load_error"],
      ["zerg", "missing"],
    ]);
    expect(report.races[1].assets[0]).toMatchObject({
      fileName: "broken.js",
      status: "load_error",
      error: expect.any(String),
    });
  });

  it("confirms every production build-order module can load", async () => {
    const report = await verifyRuntimeBuildOrderLoadability();

    expect(report.summary.ready).toBe(true);
    expect(report.summary.loadFailures).toBe(0);
    expect(report.summary.discoveredAssetFiles).toBeGreaterThan(0);
    expect(report.summary.canonicalWrites).toBe(0);
  });
});
