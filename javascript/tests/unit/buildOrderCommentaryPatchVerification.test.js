const {
  buildDryRunCommentaryPatchPlan,
} = require("../../scripts/plan-build-order-commentary-patches");
const {
  verifyDryRunCommentaryPatchPlan,
  buildCurrentPatchVerification,
} = require("../../scripts/verify-build-order-commentary-patches");

describe("build-order commentary patch verification", () => {
  it("re-extracts and verifies every current planned source row without writes", async () => {
    const verification = await buildCurrentPatchVerification();

    expect(verification).toEqual(expect.objectContaining({
      mode: "read_only_patch_verification",
      planMode: "dry_run_patch_proposal",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      summary: {
        plannedPatches: 26,
        verifiedPatches: 26,
        mismatchedPatches: 0,
        missingSourceRows: 0,
        canonicalWrites: 0,
      },
    }));
    expect(verification.checks).toHaveLength(26);
    verification.checks.forEach(check => {
      expect(check).toEqual(expect.objectContaining({
        status: "verified",
        target: expect.objectContaining({
          url: expect.stringMatching(/^https:\/\//),
          stepIndex: expect.any(Number),
          actionPartIndex: expect.any(Number),
        }),
        replacement: expect.objectContaining({
          actionPart: expect.any(String),
          comment: expect.stringMatching(/^Source suffix: /),
        }),
      }));
    });
  });

  it("reports a stale digest as a mismatch and leaves every replacement unapplied", async () => {
    const plan = await buildDryRunCommentaryPatchPlan();
    const stalePlan = {
      ...plan,
      patches: plan.patches.map((patch, index) => index === 0
        ? {
          ...patch,
          precondition: {
            ...patch.precondition,
            sourceRowDigest: "0".repeat(64),
          },
        }
        : patch),
    };

    const verification = await verifyDryRunCommentaryPatchPlan(stalePlan);

    expect(verification.summary).toEqual({
      plannedPatches: 26,
      verifiedPatches: 25,
      mismatchedPatches: 1,
      missingSourceRows: 0,
      canonicalWrites: 0,
    });
    expect(verification.checks[0]).toEqual(expect.objectContaining({
      status: "precondition_mismatch",
      replacement: plan.patches[0].replacement,
    }));
  });
});
