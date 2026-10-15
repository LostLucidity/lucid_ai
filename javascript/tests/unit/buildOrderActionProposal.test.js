const {
  buildRepairProposalManifest,
} = require("../../scripts/propose-build-order-action-repairs");

describe("build-order action repair proposals", () => {
  let manifest;

  beforeAll(async () => {
    manifest = await buildRepairProposalManifest();
  });

  it("preserves all recognized-prefix audit rows without applying repairs", () => {
    expect(manifest.mode).toBe("proposal_only");
    expect(manifest.sourceAudit).toBe(
      "data/buildOrders/scripts/scrapedBuildOrders.json"
    );
    expect(manifest.summary.proposals).toBe(34);
    expect(manifest.summary.additionalExecutableActionDetected).toBe(8);
    expect(manifest.summary.noAdditionalExecutableActionDetected).toBe(26);
    expect(manifest.proposals).toHaveLength(34);
    expect(
      manifest.summary.additionalExecutableActionDetected +
      manifest.summary.noAdditionalExecutableActionDetected
    ).toBe(34);

    manifest.proposals.forEach(proposal => {
      expect(proposal.sourceRow).toEqual(expect.objectContaining({
        classification: "recognized_prefix_with_unparsed_suffix",
        candidatePrefix: expect.any(String),
        url: expect.stringMatching(/^https:\/\//),
        stepIndex: expect.any(Number),
        actionPartIndex: expect.any(Number),
        action: expect.any(String),
        sourceAction: expect.any(String),
      }));
      expect(proposal.proposedAction).toBe(proposal.sourceRow.candidatePrefix);
      expect(proposal.rawSuffix).toBe(
        proposal.sourceRow.action.slice(proposal.proposedAction.length)
      );
      expect(proposal.suffix).toBe(proposal.rawSuffix.trim());
      expect(proposal.suffix).not.toBe("");
      expect(proposal.embeddedExecutableActions).toEqual(expect.any(Array));
    });
  });

  it("flags suffixes that contain another executable action", () => {
    const proposal = manifest.proposals.find(
      item => item.sourceRow.action === "Pylon use the pylon to close the door"
    );

    expect(proposal).toEqual(expect.objectContaining({
      proposedAction: "Pylon",
      rawSuffix: " use the pylon to close the door",
      suffix: "use the pylon to close the door",
      reviewStatus: "additional_executable_action_detected",
    }));
    expect(proposal.embeddedExecutableActions).toEqual([
      expect.objectContaining({
        text: "pylon",
        startWordIndex: 2,
        endWordIndexExclusive: 3,
      }),
    ]);
  });

  it("keeps narrative-only suffixes in the no-additional-action review lane", () => {
    const proposal = manifest.proposals.find(
      item => item.sourceRow.action === "Shield Battery at fourth base"
    );

    expect(proposal).toEqual(expect.objectContaining({
      proposedAction: "Shield Battery",
      suffix: "at fourth base",
      embeddedExecutableActions: [],
      reviewStatus: "no_additional_executable_action_detected",
    }));
  });
});
