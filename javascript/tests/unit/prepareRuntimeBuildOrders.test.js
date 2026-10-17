const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const {
  prepareRuntimeBuildOrders,
} = require("../../scripts/prepare-runtime-build-orders");

const CANONICAL_SOURCE = path.join(
  __dirname,
  "../../data/buildOrders/scripts/scrapedBuildOrders.json"
);

describe("fresh-checkout runtime build-order preparation", () => {
  let outputRoot;

  beforeEach(async () => {
    outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lucid-prepare-runtime-assets-"));
  });

  afterEach(async () => {
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  it("generates and verifies all canonical assets from an empty runtime root", async () => {
    for (const race of ["protoss", "terran", "zerg"]) {
      await expect(fs.access(path.join(outputRoot, race))).rejects.toMatchObject({ code: "ENOENT" });
    }

    const report = await prepareRuntimeBuildOrders(outputRoot, CANONICAL_SOURCE);

    expect(report.summary).toEqual({
      generatedAssets: 60,
      generatedByRace: { protoss: 23, terran: 19, zerg: 18 },
      canonicalBuildOrders: 60,
      matchedBuildOrders: 60,
      loadedBuildOrders: 60,
      ready: true,
      canonicalWrites: 0,
      generatedWrites: 60,
    });
  });
});
