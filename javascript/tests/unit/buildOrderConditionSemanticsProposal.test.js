const {
  buildConditionSemanticsProposal,
  proposeConditionSemantics,
} = require("../../scripts/propose-build-order-condition-semantics");

describe("build-order condition semantics proposal", () => {
  let proposal;

  beforeAll(async () => {
    proposal = await buildConditionSemanticsProposal();
  });

  it("keeps every condition-classified row out of canonical apply", () => {
    expect(proposal).toEqual(expect.objectContaining({
      mode: "read_only_condition_semantics_proposal",
      sourceScreenMode: "semantic_loss_screen",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      activeRuntimeConditionInterface: expect.objectContaining({
        completionChecks: "unit target counts and upgrade completion",
      }),
      summary: {
        conditionRows: 1,
        representableRows: 0,
        byStatus: { unsupported: 1 },
        canonicalWrites: 0,
      },
    }));
    expect(proposal.rows).toHaveLength(1);
    proposal.rows.forEach(row => {
      expect(row.canonicalWrites).toBe(0);
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.status).not.toBe("representable");
    });
  });

  it("does not turn a stalled-game response into an executable condition", () => {
    const [row] = proposal.rows;

    expect(row.sourceRow.action).toBe(
      "Nydus Network Si la partida se estanca empezas a moverte por los tuneles para crear jugadas."
    );
    expect(row).toEqual(expect.objectContaining({
      status: "unsupported",
      runtimeConcept: null,
    }));
    expect(proposeConditionSemantics({
      commentary: { sourceSuffix: "if the game stagnates" },
    })).toEqual({
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The source is a strategic response to a stalled game; the active build-order model has no condition field or stalled-game predicate.",
    });
  });
});
