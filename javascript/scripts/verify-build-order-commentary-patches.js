"use strict";

const {
  buildUnresolvedActionReport,
} = require("./audit-build-order-actions");
const {
  buildDryRunCommentaryPatchPlan,
  verifyPatchPrecondition,
} = require("./plan-build-order-commentary-patches");

function targetKey(row) {
  return [row.url, row.stepIndex, row.actionPartIndex].join("\u0000");
}

async function verifyDryRunCommentaryPatchPlan(plan) {
  const report = await buildUnresolvedActionReport();
  const currentRowsByTarget = new Map(
    report.rows.map(row => [targetKey(row), row])
  );
  const checks = plan.patches.map(patch => {
    const target = patch.application.target;
    const currentSourceRow = currentRowsByTarget.get(targetKey(target));

    if (!currentSourceRow) {
      return {
        target,
        status: "source_row_not_found",
        replacement: patch.replacement,
      };
    }

    if (!verifyPatchPrecondition(patch, currentSourceRow)) {
      return {
        target,
        status: "precondition_mismatch",
        replacement: patch.replacement,
      };
    }

    return {
      target,
      status: "verified",
      precondition: patch.precondition,
      replacement: patch.replacement,
      commentary: patch.commentary,
    };
  });
  const verifiedPatches = checks.filter(check => check.status === "verified");
  const missingSourceRows = checks.filter(
    check => check.status === "source_row_not_found"
  ).length;

  return {
    mode: "read_only_patch_verification",
    sourceAudit: report.source,
    planMode: plan.mode,
    summary: {
      plannedPatches: plan.patches.length,
      verifiedPatches: verifiedPatches.length,
      mismatchedPatches: checks.length - verifiedPatches.length,
      missingSourceRows,
      canonicalWrites: 0,
    },
    checks,
  };
}

async function buildCurrentPatchVerification() {
  const plan = await buildDryRunCommentaryPatchPlan();
  return verifyDryRunCommentaryPatchPlan(plan);
}

if (require.main === module) {
  buildCurrentPatchVerification()
    .then(verification => process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order commentary patch verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  verifyDryRunCommentaryPatchPlan,
  buildCurrentPatchVerification,
};
