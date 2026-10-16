const {
  buildConditionFieldDesignProposal,
} = require("../../scripts/propose-build-order-condition-field-design");

describe("build-order condition field design proposal", () => {
  let proposal;

  beforeAll(async () => {
    proposal = await buildConditionFieldDesignProposal();
  });

  it("defines a read-only, backward-compatible condition contract", () => {
    expect(proposal).toEqual(expect.objectContaining({
      mode: "read_only_condition_field_design_proposal",
      sourceProposalMode: "read_only_condition_semantics_proposal",
      summary: {
        sourceConditionRows: 1,
        canonicalWrites: 0,
        runtimeWrites: 0,
        sourceOwnerConfirmationRequired: true,
      },
      conditionFieldContract: expect.objectContaining({
        field: "condition",
        location: "optional BuildOrderStep property",
        backwardCompatibility: "A missing condition preserves the current unconditional step behavior.",
      }),
      evaluationContract: expect.objectContaining({
        interface: "evaluateBuildOrderCondition(world, condition) => satisfied | unsatisfied | unknown",
      }),
    }));
  });

  it("fails closed without deriving behavior from source prose", () => {
    expect(proposal.conditionFieldContract.parserRule).toContain(
      "comments and action suffixes are never inferred"
    );
    expect(proposal.evaluationContract.executionRule).toBe(
      "Only satisfied releases a condition-bearing step; unsatisfied and unknown preserve the step without issuing its action."
    );
    expect(proposal.requiredRegressions).toEqual(expect.arrayContaining([
      expect.stringContaining("Malformed or unsupported condition objects fail closed"),
    ]));
  });
});
