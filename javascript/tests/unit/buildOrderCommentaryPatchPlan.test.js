const {
  buildDryRunCommentaryPatchPlan,
  verifyPatchPrecondition,
} = require("../../scripts/plan-build-order-commentary-patches");

describe("build-order commentary dry-run patch plan", () => {
  let plan;

  beforeAll(async () => {
    plan = await buildDryRunCommentaryPatchPlan();
  });

  it("plans only narrative/context-only suffix repairs without canonical writes", () => {
    expect(plan).toEqual(expect.objectContaining({
      mode: "dry_run_patch_proposal",
      sourceManifestMode: "proposal_only",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      summary: {
        plannedPatches: 26,
        excludedForManualReview: 8,
        canonicalWrites: 0,
      },
    }));
    expect(plan.patches).toHaveLength(26);

    plan.patches.forEach(patch => {
      expect(patch.sourceRow).toEqual(expect.objectContaining({
        classification: "recognized_prefix_with_unparsed_suffix",
        candidatePrefix: expect.any(String),
        url: expect.stringMatching(/^https:\/\//),
        stepIndex: expect.any(Number),
        actionPartIndex: expect.any(Number),
      }));
      expect(patch.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(patch.replacement.actionPart).toBe(patch.sourceRow.candidatePrefix);
      expect(patch.commentary.sourceSuffix).toBe(
        patch.sourceRow.action.slice(patch.sourceRow.candidatePrefix.length).trim()
      );
      expect(patch.replacement.comment).toContain(
        `Source suffix: ${patch.commentary.sourceSuffix}`
      );
      expect(patch.application.mode).toBe("dry_run_only");
      expect(verifyPatchPrecondition(patch, patch.sourceRow)).toBe(true);
    });
  });

  it("fails the digest guard when the canonical source row changes", () => {
    const patch = plan.patches.find(
      item => item.sourceRow.action === "Shield Battery at fourth base"
    );
    const changedSourceRow = {
      ...patch.sourceRow,
      action: "Shield Battery at fifth base",
    };

    expect(patch).toEqual(expect.objectContaining({
      replacement: {
        actionPart: "Shield Battery",
        comment: "Source suffix: at fourth base",
      },
    }));
    expect(verifyPatchPrecondition(patch, changedSourceRow)).toBe(false);
  });
});
