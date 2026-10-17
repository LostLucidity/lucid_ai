"use strict";

const {
  buildSuffixSemanticLossScreen,
} = require("./screen-build-order-suffix-semantics");

const ACTIVE_RUNTIME_COUNT_SYNTAX = Object.freeze({
  syntax: "<action> xN",
  evidence: "data/buildOrders/scripts/buildOrderUtils.js extractActionDetails",
  limitation: "Only an explicit xN suffix is parsed as an action count; target counts, maxima, ratios, resource counts, and conditions are not represented.",
});

function proposeCountSemantics(row) {
  const suffix = row.commentary.sourceSuffix;

  if (/^-\s*2\s+if\b/i.test(suffix)) {
    return {
      status: "ambiguous_existing_xN",
      runtimeConcept: "<action> xN",
      rationale: "The source mentions two actions conditionally, but it is not the parser's explicit xN syntax and may encode a reaction gate.",
    };
  }

  if (/\b(?:max|ratio|gas|bases|until|hasta)\b/i.test(suffix) || /\b\d+\b/.test(suffix)) {
    return {
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The source quantity is a target, ratio, resource count, or condition rather than an explicit per-action xN count.",
    };
  }

  return {
    status: "unsupported",
    runtimeConcept: null,
    rationale: "No exact active count syntax represents this source instruction.",
  };
}

async function buildCountSemanticsProposal() {
  const screen = await buildSuffixSemanticLossScreen();
  const rows = screen.rows
    .filter(row => row.classification === "count")
    .map(row => ({
      sourceRow: row.sourceRow,
      precondition: row.precondition,
      commentary: row.commentary,
      ...proposeCountSemantics(row),
      canonicalWrites: 0,
    }));
  const byStatus = {};

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }

  return {
    mode: "read_only_count_semantics_proposal",
    sourceAudit: screen.sourceAudit,
    sourceScreenMode: screen.mode,
    activeRuntimeCountSyntax: ACTIVE_RUNTIME_COUNT_SYNTAX,
    summary: {
      countRows: rows.length,
      representableRows: rows.filter(row => row.status === "representable").length,
      byStatus,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildCountSemanticsProposal()
    .then(proposal => process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order count semantics proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildCountSemanticsProposal,
  proposeCountSemantics,
};
