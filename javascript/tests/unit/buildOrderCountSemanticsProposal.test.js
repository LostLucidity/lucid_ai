const {
  buildCountSemanticsProposal,
  proposeCountSemantics,
} = require("../../scripts/propose-build-order-count-semantics");

describe("build-order count semantics proposal", () => {
  let proposal;

  beforeAll(async () => {
    proposal = await buildCountSemanticsProposal();
  });

  it("keeps every count-classified row out of canonical apply", () => {
    expect(proposal).toEqual(expect.objectContaining({
      mode: "read_only_count_semantics_proposal",
      sourceScreenMode: "semantic_loss_screen",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      activeRuntimeCountSyntax: expect.objectContaining({ syntax: "<action> xN" }),
      summary: {
        countRows: 8,
        representableRows: 0,
        byStatus: {
          unsupported: 5,
          ambiguous_existing_xN: 3,
        },
        canonicalWrites: 0,
      },
    }));
    proposal.rows.forEach(row => {
      expect(row.canonicalWrites).toBe(0);
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.status).not.toBe("representable");
    });
  });

  it("does not confuse conditional two-count phrasing with explicit xN syntax", () => {
    const find = action => proposal.rows.find(row => row.sourceRow.action === action);

    expect(find("Extractor 1 Gas")).toEqual(expect.objectContaining({
      status: "unsupported",
      runtimeConcept: null,
    }));
    expect(find("Nydus Network - 2 if you think reaction will be too quick")).toEqual(
      expect.objectContaining({
        status: "ambiguous_existing_xN",
        runtimeConcept: "<action> xN",
      })
    );
    expect(find("Lurker Den Cuando ya tenes algunos Hydra empezas a mechar Lurkers. (Ratio de 1 a 3 o 4)")).toEqual(
      expect.objectContaining({ status: "unsupported" })
    );
  });

  it("leaves a target count unsupported even when it includes a number", () => {
    expect(proposeCountSemantics({
      commentary: { sourceSuffix: "until 12 units" },
    })).toEqual({
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The source quantity is a target, ratio, resource count, or condition rather than an explicit per-action xN count.",
    });
  });
});
