const { buildUnresolvedActionReport } = require("../../scripts/audit-build-order-actions");
const { Ability, UnitType, Upgrade } = require("@node-sc2/core/constants");
const { executeSpecialAction } = require("../../src/features/strategy/specialActions");

describe("build-order unresolved-action audit", () => {
  let report;

  beforeAll(async () => {
    report = await buildUnresolvedActionReport();
  });

  it("reports every remaining canonical unresolved action without changing source data", async () => {
    expect(report.source).toBe("data/buildOrders/scripts/scrapedBuildOrders.json");
    expect(report.summary.buildOrders).toBe(60);
    expect(report.summary.unresolvedActions).toBe(63);
    expect(report.summary.affectedOrders).toBe(12);
    expect(report.summary.byRace).toEqual({
      protoss: { unresolvedActions: 17, affectedOrders: 3 },
      terran: { unresolvedActions: 17, affectedOrders: 6 },
      zerg: { unresolvedActions: 29, affectedOrders: 3 },
    });
    expect(report.summary.byClassification).toEqual({
      generic_placeholder: 17,
      unsupported_runtime_action: 4,
      recognized_prefix_with_unparsed_suffix: 34,
      unstructured_text: 3,
      narrative_text: 2,
      placeholder_with_context: 3,
    });
    expect(report.rows).toHaveLength(63);
    expect(
      Object.values(report.summary.byRace)
        .reduce((total, race) => total + race.unresolvedActions, 0)
    ).toBe(63);
    expect(
      Object.values(report.summary.byClassification)
        .reduce((total, count) => total + count, 0)
    ).toBe(63);

    report.rows.forEach(row => {
      expect(row).toEqual(expect.objectContaining({
        race: expect.any(String),
        title: expect.any(String),
        url: expect.stringMatching(/^https:\/\//),
        stepIndex: expect.any(Number),
        actionPartIndex: expect.any(Number),
        action: expect.any(String),
        sourceAction: expect.any(String),
        comment: expect.any(String),
        classification: expect.any(String),
        classificationReason: expect.any(String),
      }));
      expect(row).toHaveProperty("supply");
      expect(row).toHaveProperty("time");
      expect(row).toHaveProperty("candidatePrefix");
    });
  });

  it.each([
    ["Action", "generic_placeholder", null],
    ["Action x3", "generic_placeholder", null],
    ["Action - Send drone to 3rd expansion", "placeholder_with_context", null],
    ["Photon Cannon at fourth base", "recognized_prefix_with_unparsed_suffix", "Photon Cannon"],
    ["Dark Pylon", "unsupported_runtime_action", null],
    ["Interference Matrix", "unsupported_runtime_action", null],
    ["crossmap for scout", "narrative_text", null],
    ["dont worry", "narrative_text", null],
    ["but you might have 80 supply", "unstructured_text", null],
  ])("classifies %s without promoting it", (action, expectedClass, expectedPrefix) => {
    expect(report.rows.find(row => row.action === action)).toEqual(
      expect.objectContaining({
        classification: expectedClass,
        candidatePrefix: expectedPrefix,
      })
    );
  });

  it("keeps unsupported labels out of installed constants and special-action execution", () => {
    const normalize = value => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const constants = [UnitType, Upgrade, Ability];
    for (const label of ["Dark Pylon", "Interference Matrix"]) {
      const normalizedLabel = normalize(label);
      const exactMatches = constants.flatMap(constant =>
        Object.keys(constant).filter(key =>
          Number.isNaN(Number(key)) && normalize(key).endsWith(normalizedLabel)
        )
      );
      expect(exactMatches).toEqual([]);
    }

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    for (const label of ["Dark Pylon", "Interference Matrix"]) {
      expect(executeSpecialAction(label, {})).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(`Unhandled special action: ${label}`);
    }
    warnSpy.mockRestore();
  });

  it("removes runtime-supported upgrades from the unresolved report", () => {
    expect(Upgrade.DIGGINGCLAWS).toBe(293);
    expect(Upgrade.LURKERRANGE).toBe(127);
    expect(report.rows.find(row => row.action === "Adaptive Talons")).toBeUndefined();
    expect(report.rows.find(row => row.action === "Seismic Spines")).toBeUndefined();
  });
});
