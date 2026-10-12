const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const {
  summarizeBuildOrderAggregate,
  verifyRuntimeBuildOrderPublicLoader,
} = require("../../scripts/verify-runtime-build-order-public-loader");

describe("runtime build-order public loader", () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "lucid-public-loader-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function generateFixture(outputRoot, name) {
    for (const [race, raceMatchup] of [["protoss", "PvX"], ["terran", "TvX"], ["zerg", "ZvX"]]) {
      const directory = path.join(outputRoot, race);
      await fs.mkdir(directory, { recursive: true });
      const buildOrder = { title: name, raceMatchup, url: "https://example.invalid/fixture", steps: [] };
      await fs.writeFile(path.join(directory, `${name}.js`), `module.exports = ${JSON.stringify(buildOrder)};\n`);
    }
  }

  it("reports an incomplete aggregate without writing", () => {
    const report = summarizeBuildOrderAggregate({
      protoss: { opener: {} },
      terran: {},
    });

    expect(report.summary).toEqual({
      requiredRaceMaps: 3,
      readyRaceMaps: 1,
      unavailableRaceMaps: 2,
      loadedBuildOrders: 1,
      ready: false,
      canonicalWrites: 0,
      generatedWrites: 0,
    });
    expect(report.races.map(race => [race.race, race.status])).toEqual([
      ["protoss", "ready"],
      ["terran", "empty"],
      ["zerg", "empty"],
    ]);
  });

  it("loads temporary three-race assets through the production public loader without writes", async () => {
    await generateFixture(root, "opener");
    const writeSpy = jest.spyOn(fs, "writeFile");
    let report;
    try {
      report = await verifyRuntimeBuildOrderPublicLoader(root);
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }

    expect(report.summary.ready).toBe(true);
    expect(report.summary.loadedBuildOrders).toBe(3);
    expect(report.races.map(race => race.buildOrderKeys)).toEqual([["opener"], ["opener"], ["opener"]]);
    expect(report.summary.canonicalWrites).toBe(0);
  });

  it("does not reuse cached race maps from another root", async () => {
    const secondRoot = path.join(root, "second");
    await generateFixture(root, "first");
    await generateFixture(secondRoot, "second");
    await verifyRuntimeBuildOrderPublicLoader(root);
    const report = await verifyRuntimeBuildOrderPublicLoader(secondRoot);
    expect(report.races.map(race => race.buildOrderKeys)).toEqual([["second"], ["second"], ["second"]]);
  });

  it("rejects a missing asset root without falling back to production files", async () => {
    await expect(verifyRuntimeBuildOrderPublicLoader(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
