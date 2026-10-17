const fs = require("fs");
const os = require("os");
const path = require("path");
const { Upgrade } = require("@node-sc2/core/constants");

const {
  buildOrderCache,
  generateBuildOrderFiles,
  loadBuildOrdersFromDirectory,
} = require("../../data/buildOrders/scripts/buildOrderUtils");

const SOURCE_PATH = path.join(
  __dirname,
  "../../data/buildOrders/scripts/scrapedBuildOrders.json"
);

const VALID_FIXTURE = [
  {
    title: "Protoss fixture",
    raceMatchup: "PvX",
    steps: [{ supply: 12, time: "0:12", action: "Probe", comment: "" }],
  },
  {
    title: "Terran fixture",
    raceMatchup: "TvX",
    steps: [{ supply: 12, time: "0:12", action: "SCV", comment: "" }],
  },
  {
    title: "Zerg fixture",
    raceMatchup: "ZvX",
    steps: [{ supply: 12, time: "0:12", action: "Drone", comment: "" }],
  },
];

describe("build-order asset generation", () => {
  let outputRoot;
  let sourcePath;

  beforeEach(async () => {
    outputRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lucid-build-orders-"));
    sourcePath = path.join(outputRoot, "source.json");
    for (const key in buildOrderCache) {
      delete buildOrderCache[key];
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.promises.rm(outputRoot, { recursive: true, force: true });
  });

  async function writeFixture(buildOrders = VALID_FIXTURE) {
    await fs.promises.writeFile(sourcePath, JSON.stringify(buildOrders), "utf8");
  }

  it("preserves the canonical race counts without empty sentinel steps", async () => {
    const source = JSON.parse(await fs.promises.readFile(SOURCE_PATH, "utf8"));
    const counts = source.reduce((result, buildOrder) => {
      const race = { P: "protoss", T: "terran", Z: "zerg" }[buildOrder.raceMatchup[0]];
      result[race] += 1;
      return result;
    }, { protoss: 0, terran: 0, zerg: 0 });

    expect(counts).toEqual({ protoss: 23, terran: 19, zerg: 18 });
    const emptySentinels = source
      .flatMap(buildOrder => buildOrder.steps)
      .filter(step => !step || typeof step.action !== "string" || !step.action.trim());
    expect(emptySentinels).toEqual([]);
  });

  it("fails closed when canonical actions cannot be resolved", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await writeFixture([
      {
        title: "Unresolved fixture",
        raceMatchup: "PvX",
        steps: [{ supply: 12, time: "0:12", action: "Unknown Action", comment: "" }],
      },
    ]);

    await expect(generateBuildOrderFiles(sourcePath, outputRoot))
      .rejects.toThrow(/unresolved action/);

    for (const race of ["protoss", "terran", "zerg"]) {
      await expect(fs.promises.access(path.join(outputRoot, race))).rejects.toThrow();
    }
  });

  it("preserves explicit canonical interpretations instead of reclassifying them", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const canonicalInterpretation = [{
      unitType: null,
      upgradeType: Upgrade.WARPGATERESEARCH,
      count: 1,
      isUpgrade: true,
      isChronoBoosted: false,
      specialAction: null,
    }];
    await writeFixture([
      {
        title: "Canonical Warp Gate fixture",
        raceMatchup: "PvX",
        steps: [{
          supply: 23,
          time: "2:09",
          action: "Warp Gate",
          interpretedAction: canonicalInterpretation,
          comment: "",
        }],
      },
    ]);

    await generateBuildOrderFiles(sourcePath, outputRoot);
    const buildOrders = await loadBuildOrdersFromDirectory("protoss", outputRoot);

    expect(buildOrders.canonical_warp_gate_fixture.steps[0].interpretedAction)
      .toEqual(canonicalInterpretation);
  });

  it("generates valid assets and round-trips them through the loader", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    await writeFixture();

    const counts = await generateBuildOrderFiles(sourcePath, outputRoot);
    expect(counts).toEqual({ protoss: 1, terran: 1, zerg: 1 });

    for (const race of ["protoss", "terran", "zerg"]) {
      const buildOrders = await loadBuildOrdersFromDirectory(race, outputRoot);
      expect(Object.keys(buildOrders)).toHaveLength(1);
      const [buildOrder] = Object.values(buildOrders);
      expect(buildOrder.steps[0].interpretedAction).toHaveLength(1);
      expect(buildOrder.steps[0].interpretedAction[0].unitType).not.toBeNull();
    }
  });

  it("rejects filename collisions before creating output directories", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    await writeFixture([
      VALID_FIXTURE[0],
      { ...VALID_FIXTURE[0], title: "Protoss-fixture" },
    ]);

    await expect(generateBuildOrderFiles(sourcePath, outputRoot))
      .rejects.toThrow("Build-order filename collision: protoss/protoss_fixture.js");
    await expect(fs.promises.access(path.join(outputRoot, "protoss"))).rejects.toThrow();
  });

  it("removes stale generated JavaScript files without touching other files", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    await writeFixture();

    const terranDirectory = path.join(outputRoot, "terran");
    await fs.promises.mkdir(terranDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(terranDirectory, "stale.js"), "module.exports = {};\n");
    await fs.promises.writeFile(path.join(terranDirectory, "keep.txt"), "keep\n");

    await generateBuildOrderFiles(sourcePath, outputRoot);

    await expect(fs.promises.access(path.join(terranDirectory, "stale.js"))).rejects.toThrow();
    await expect(fs.promises.readFile(path.join(terranDirectory, "keep.txt"), "utf8"))
      .resolves.toBe("keep\n");
  });
});
