"use strict";

const { buildUnresolvedActionReport } = require("./audit-build-order-actions");
const {
  interpretBuildOrderAction,
} = require("../data/buildOrders/scripts/buildOrderUtils");

const TARGET_CLASSIFICATION = "recognized_prefix_with_unparsed_suffix";

function interpretSilently(action) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return interpretBuildOrderAction(action, "");
  } finally {
    console.warn = originalWarn;
  }
}

function isResolvedAction(action) {
  return action.unitType !== null ||
    action.upgradeType !== null ||
    action.specialAction !== null;
}

function trimBoundaryPunctuation(value) {
  return value
    .replace(/^[\s\-:;,.!?]+/, "")
    .replace(/[\s\-:;,.!?]+$/, "")
    .trim();
}

function detectEmbeddedExecutableActions(suffix) {
  const words = suffix.trim().split(/\s+/).filter(Boolean);
  const matches = [];
  let startWordIndex = 0;

  while (startWordIndex < words.length) {
    let match = null;

    for (let endWordIndexExclusive = words.length;
      endWordIndexExclusive > startWordIndex;
      endWordIndexExclusive -= 1) {
      const text = trimBoundaryPunctuation(
        words.slice(startWordIndex, endWordIndexExclusive).join(" ")
      );
      if (!text) continue;

      const interpretedActions = interpretSilently(text);
      if (interpretedActions.length === 0 || !interpretedActions.every(isResolvedAction)) {
        continue;
      }

      match = {
        text,
        startWordIndex,
        endWordIndexExclusive,
        interpretedActions,
      };
      break;
    }

    if (match) {
      matches.push(match);
      startWordIndex = match.endWordIndexExclusive;
    } else {
      startWordIndex += 1;
    }
  }

  return matches;
}

async function buildRepairProposalManifest() {
  const audit = await buildUnresolvedActionReport();
  const proposals = audit.rows
    .filter(row => row.classification === TARGET_CLASSIFICATION)
    .map(row => {
      if (!row.candidatePrefix || !row.action.startsWith(row.candidatePrefix)) {
        throw new Error(
          `Invalid candidate prefix at ${row.url} step ${row.stepIndex} action ${row.actionPartIndex}`
        );
      }

      const rawSuffix = row.action.slice(row.candidatePrefix.length);
      const suffix = rawSuffix.trim();
      const embeddedExecutableActions = detectEmbeddedExecutableActions(suffix);

      return {
        sourceRow: { ...row },
        proposedAction: row.candidatePrefix,
        rawSuffix,
        suffix,
        embeddedExecutableActions,
        reviewStatus: embeddedExecutableActions.length > 0
          ? "additional_executable_action_detected"
          : "no_additional_executable_action_detected",
      };
    });

  const additionalExecutableActionDetected = proposals.filter(
    proposal => proposal.reviewStatus === "additional_executable_action_detected"
  ).length;

  return {
    mode: "proposal_only",
    sourceAudit: audit.source,
    summary: {
      proposals: proposals.length,
      additionalExecutableActionDetected,
      noAdditionalExecutableActionDetected:
        proposals.length - additionalExecutableActionDetected,
    },
    proposals,
  };
}

if (require.main === module) {
  buildRepairProposalManifest()
    .then(manifest => process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order repair proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildRepairProposalManifest,
};
