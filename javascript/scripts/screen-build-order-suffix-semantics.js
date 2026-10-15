"use strict";

const {
  buildDryRunCommentaryPatchPlan,
} = require("./plan-build-order-commentary-patches");

const LOCATION_PATTERN = /\b(?:natural|main|base|enemy|inside)\b/i;
const COUNT_PATTERN = /\b\d+\b|\bmax\b|\bratio\b/i;
const CONDITION_PATTERN = /\b(?:if|when|until|after|before|si|cuando|ya)\b/i;
const STRATEGY_PATTERN = /\b(?:attack|kill|speed|tech|saturar|gases|lings|hydras|mejor|tuneles|rally|spam)\b/i;
const NARRATIVE_ONLY_PATTERN = /^(?:note|reminder|flavor)\b/i;

function classifySemanticLoss(patch) {
  const suffix = patch.commentary.sourceSuffix;
  const sourceAction = patch.sourceRow.sourceAction;
  const signals = [];

  if (sourceAction.includes(",")) signals.push("multi_action");
  if (LOCATION_PATTERN.test(suffix)) signals.push("location");
  if (COUNT_PATTERN.test(suffix)) signals.push("count");
  if (CONDITION_PATTERN.test(suffix)) signals.push("condition");
  if (STRATEGY_PATTERN.test(suffix)) signals.push("strategic_instruction");

  let classification = "unclassified_semantic";
  if (signals.includes("multi_action")) {
    classification = "multi_action";
  } else if (signals.includes("location")) {
    classification = "location";
  } else if (signals.includes("count")) {
    classification = "count";
  } else if (signals.includes("condition")) {
    classification = "condition";
  } else if (signals.includes("strategic_instruction")) {
    classification = "strategic_instruction";
  } else if (NARRATIVE_ONLY_PATTERN.test(suffix)) {
    classification = "narrative_only";
  }

  return {
    classification,
    signals,
    eligibleForCanonicalApply: classification === "narrative_only",
    rationale: classification === "narrative_only"
      ? "Suffix matches the narrowly defined narrative-only allowlist."
      : "Suffix carries or may carry runtime semantics; preserve it for manual handling.",
  };
}

async function buildSuffixSemanticLossScreen() {
  const plan = await buildDryRunCommentaryPatchPlan();
  const rows = plan.patches.map(patch => ({
    sourceRow: patch.sourceRow,
    precondition: patch.precondition,
    replacement: patch.replacement,
    commentary: patch.commentary,
    ...classifySemanticLoss(patch),
  }));
  const byClassification = {};

  for (const row of rows) {
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
  }

  const eligibleForCanonicalApply = rows.filter(
    row => row.eligibleForCanonicalApply
  ).length;

  return {
    mode: "semantic_loss_screen",
    sourceAudit: plan.sourceAudit,
    sourcePlanMode: plan.mode,
    summary: {
      screenedRows: rows.length,
      eligibleForCanonicalApply,
      blockedForManualHandling: rows.length - eligibleForCanonicalApply,
      byClassification,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildSuffixSemanticLossScreen()
    .then(screen => process.stdout.write(`${JSON.stringify(screen, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order suffix semantic screen failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildSuffixSemanticLossScreen,
  classifySemanticLoss,
};
