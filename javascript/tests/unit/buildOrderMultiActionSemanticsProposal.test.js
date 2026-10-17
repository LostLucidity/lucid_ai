const {
  buildMultiActionSemanticsProposal,
  proposeMultiActionSemantics,
} = require("../../scripts/propose-build-order-multi-action-semantics");

describe("build-order multi-action semantics proposal", () => {
  let proposal;

  beforeAll(async () => {
    proposal = await buildMultiActionSemanticsProposal();
  });

  it("keeps every multi-action-classified row out of canonical apply", () => {
    expect(proposal).toEqual(expect.objectContaining({
      mode: "read_only_multi_action_semantics_proposal",
      sourceScreenMode: "semantic_loss_screen",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      activeRuntimeMultiActionInterface: expect.objectContaining({
        syntax: "comma-separated action parts",
      }),
      summary: {
        multiActionRows: 5,
        independentlyExecutableSiblingRows: 2,
        representableRows: 0,
        byStatus: {
          independent_existing_sibling: 2,
          no_independent_existing_sibling: 3,
        },
        canonicalWrites: 0,
      },
    }));
    proposal.rows.forEach(row => {
      expect(row.canonicalWrites).toBe(0);
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it("identifies exact sibling actions without rewriting the unsupported row", () => {
    const find = action => proposal.rows.find(row => row.sourceRow.action === action);

    expect(find("Photon Cannon at third base")).toEqual(expect.objectContaining({
      status: "independent_existing_sibling",
      independentlyExecutableSiblings: [expect.objectContaining({
        actionPart: "Shield Battery",
        actionPartIndex: 0,
      })],
    }));
    expect(find("Photon Cannon at  fourth base")).toEqual(expect.objectContaining({
      status: "independent_existing_sibling",
      independentlyExecutableSiblings: [expect.objectContaining({
        actionPart: "Robotics Bay",
        actionPartIndex: 0,
      })],
    }));
    expect(find("Adept (Chrono Boost) when finished")).toEqual(expect.objectContaining({
      status: "no_independent_existing_sibling",
      independentlyExecutableSiblings: [],
    }));
  });

  it("does not claim a narrative sibling is executable", () => {
    expect(proposeMultiActionSemantics({
      sourceRow: {
        sourceAction: "Adept, crossmap for scout",
        actionPartIndex: 0,
      },
    })).toEqual(expect.objectContaining({
      status: "no_independent_existing_sibling",
      independentlyExecutableSiblings: [],
    }));
  });
});
