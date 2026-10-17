const {
  buildSuffixSemanticLossScreen,
  classifySemanticLoss,
} = require("../../scripts/screen-build-order-suffix-semantics");

describe("build-order suffix semantic-loss screen", () => {
  let screen;

  beforeAll(async () => {
    screen = await buildSuffixSemanticLossScreen();
  });

  it("fails closed for every current verified repair candidate", () => {
    expect(screen).toEqual(expect.objectContaining({
      mode: "semantic_loss_screen",
      sourcePlanMode: "dry_run_patch_proposal",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      summary: expect.objectContaining({
        screenedRows: 26,
        eligibleForCanonicalApply: 0,
        blockedForManualHandling: 26,
        canonicalWrites: 0,
      }),
    }));
    expect(screen.rows).toHaveLength(26);
    screen.rows.forEach(row => {
      expect(row.eligibleForCanonicalApply).toBe(false);
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.rationale).toMatch(/runtime semantics/i);
    });
  });

  it("identifies multi-action, location, count, condition, and strategy signals", () => {
    const find = action => screen.rows.find(row => row.sourceRow.action === action);

    expect(find("Adept (Chrono Boost) when finished")).toEqual(
      expect.objectContaining({ classification: "multi_action" })
    );
    expect(find("Shield Battery at fourth base")).toEqual(
      expect.objectContaining({ classification: "location" })
    );
    expect(find("Extractor 1 Gas")).toEqual(
      expect.objectContaining({ classification: "count" })
    );
    expect(find("Nydus Network - 2 if you think reaction will be too quick")).toEqual(
      expect.objectContaining({ classification: "count" })
    );
    expect(find("Oracle (Chrono Boost) you can try to kill some drones with oracles")).toEqual(
      expect.objectContaining({ classification: "strategic_instruction" })
    );
  });

  it("withholds a narrative-looking suffix from canonical application", () => {
    expect(classifySemanticLoss({
      sourceRow: { sourceAction: "Pylon note do not build" },
      commentary: { sourceSuffix: "note do not build" },
    })).toEqual({
      classification: "unclassified_semantic",
      signals: [],
      eligibleForCanonicalApply: false,
      rationale: "Suffix carries or may carry runtime semantics; preserve it for manual handling.",
    });
  });
});
