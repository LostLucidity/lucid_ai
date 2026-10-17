"use strict";

const crypto = require("crypto");

const {
  buildRepairProposalManifest,
} = require("./propose-build-order-action-repairs");

const PATCHABLE_REVIEW_STATUS = "no_additional_executable_action_detected";

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(",")}}`;
  }

  return JSON.stringify(value);
}

function sourceRowDigest(sourceRow) {
  return crypto
    .createHash("sha256")
    .update(stableSerialize(sourceRow), "utf8")
    .digest("hex");
}

function buildProposedComment(sourceRow, suffix) {
  const suffixComment = `Source suffix: ${suffix}`;
  return sourceRow.comment
    ? `${sourceRow.comment}\n${suffixComment}`
    : suffixComment;
}

function buildPatch(proposal) {
  const sourceRow = { ...proposal.sourceRow };
  const digest = sourceRowDigest(sourceRow);

  return {
    sourceRow,
    precondition: {
      sourceRowDigest: digest,
      sourceAction: sourceRow.sourceAction,
      actionPart: sourceRow.action,
      comment: sourceRow.comment,
    },
    replacement: {
      actionPart: proposal.proposedAction,
      comment: buildProposedComment(sourceRow, proposal.suffix),
    },
    commentary: {
      sourceSuffix: proposal.suffix,
      rawSourceSuffix: proposal.rawSuffix,
    },
    application: {
      mode: "dry_run_only",
      target: {
        url: sourceRow.url,
        stepIndex: sourceRow.stepIndex,
        actionPartIndex: sourceRow.actionPartIndex,
      },
      instruction: "Replace only the guarded action part and comment after source-row digest verification.",
    },
  };
}

function verifyPatchPrecondition(patch, currentSourceRow) {
  return patch.precondition.sourceRowDigest === sourceRowDigest(currentSourceRow) &&
    patch.precondition.sourceAction === currentSourceRow.sourceAction &&
    patch.precondition.actionPart === currentSourceRow.action &&
    patch.precondition.comment === currentSourceRow.comment;
}

async function buildDryRunCommentaryPatchPlan() {
  const manifest = await buildRepairProposalManifest();
  const patchableProposals = manifest.proposals.filter(
    proposal => proposal.reviewStatus === PATCHABLE_REVIEW_STATUS
  );
  const manualReviewProposals = manifest.proposals.filter(
    proposal => proposal.reviewStatus !== PATCHABLE_REVIEW_STATUS
  );
  const patches = patchableProposals.map(buildPatch);

  return {
    mode: "dry_run_patch_proposal",
    sourceAudit: manifest.sourceAudit,
    sourceManifestMode: manifest.mode,
    summary: {
      plannedPatches: patches.length,
      excludedForManualReview: manualReviewProposals.length,
      canonicalWrites: 0,
    },
    patches,
  };
}

if (require.main === module) {
  buildDryRunCommentaryPatchPlan()
    .then(plan => process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order commentary patch plan failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildDryRunCommentaryPatchPlan,
  sourceRowDigest,
  verifyPatchPrecondition,
};
