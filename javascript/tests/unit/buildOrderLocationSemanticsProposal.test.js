const {
  buildLocationSemanticsProposal,
  proposeLocationSemantics,
} = require("../../scripts/propose-build-order-location-semantics");

describe("build-order location semantics proposal", () => {
  let proposal;

  beforeAll(async () => {
    proposal = await buildLocationSemanticsProposal();
  });

  it("keeps every location-classified row out of canonical apply", () => {
    expect(proposal).toEqual(expect.objectContaining({
      mode: "read_only_location_semantics_proposal",
      sourceScreenMode: "semantic_loss_screen",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      summary: {
        locationRows: 10,
        representableRows: 0,
        byStatus: {
          ambiguous_existing_concept: 1,
          unsupported: 9,
        },
        canonicalWrites: 0,
      },
    }));
    expect(proposal.rows).toHaveLength(10);
    proposal.rows.forEach(row => {
      expect(row.canonicalWrites).toBe(0);
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.status).not.toBe("representable");
    });
  });

  it("distinguishes natural from ordinal, enemy, and main-base source instructions", () => {
    const find = action => proposal.rows.find(row => row.sourceRow.action === action);

    expect(find("Hatchery Natural")).toEqual(expect.objectContaining({
      status: "ambiguous_existing_concept",
      runtimeConcept: "natural_wall",
    }));
    expect(find("Shield Battery at fourth base")).toEqual(expect.objectContaining({
      status: "unsupported",
      runtimeConcept: null,
    }));
    expect(find("Spine Crawler - Inside enemy base")).toEqual(expect.objectContaining({
      status: "unsupported",
      runtimeConcept: "enemy_main_and_natural",
    }));
    expect(find("Zergling - Spam lings / tech up main")).toEqual(expect.objectContaining({
      status: "unsupported",
      runtimeConcept: "main_ramp",
    }));
  });

  it("does not invent an ordinal location target", () => {
    expect(proposeLocationSemantics({
      commentary: { sourceSuffix: "at third base" },
    })).toEqual({
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The active expansion selector does not preserve ordinal expansion targets.",
    });
  });
});
