"use strict";

const {
  buildConditionSemanticsProposal,
} = require("./propose-build-order-condition-semantics");
const {
  buildCountSemanticsProposal,
} = require("./propose-build-order-count-semantics");
const {
  buildLocationSemanticsProposal,
} = require("./propose-build-order-location-semantics");
const {
  buildMultiActionSemanticsProposal,
} = require("./propose-build-order-multi-action-semantics");
const {
  buildStrategicSemanticsProposal,
} = require("./propose-build-order-strategic-semantics");
const {
  buildSuffixSemanticLossScreen,
} = require("./screen-build-order-suffix-semantics");

function determineRequiredUnlock(row) {
  const action = row.sourceRow.action;
  const suffix = row.commentary.sourceSuffix;

  if (row.classification === "location") {
    if (row.status === "ambiguous_existing_concept") {
      return {
        type: "explicit_scope_decision",
        detail: "Define a generic natural-expansion construction target, including its selection and safety contract.",
      };
    }
    if (/\b(?:third|fourth)\b/i.test(suffix)) {
      return {
        type: "new_runtime_abstraction",
        detail: "Add an ordinal expansion-placement target that preserves third/fourth-base intent.",
      };
    }
    if (/\b(?:enemy|inside)\b/i.test(suffix)) {
      return {
        type: "new_runtime_abstraction",
        detail: "Add an enemy-base construction target with placement and risk rules.",
      };
    }
    if (/\bmain\b/i.test(suffix)) {
      return {
        type: "new_runtime_abstraction",
        detail: "Add a generic main-base construction target distinct from main-ramp placement.",
      };
    }
    return {
      type: "new_runtime_abstraction",
      detail: "Add a typed construction-location target that preserves this source instruction.",
    };
  }

  if (row.classification === "count") {
    return {
      type: "new_runtime_abstraction",
      detail: row.status === "ambiguous_existing_xN"
        ? "Add a conditional action-count grammar; the existing xN syntax has no reaction gate."
        : "Add typed target, ratio, resource, or conditional count semantics beyond xN.",
    };
  }

  if (row.classification === "condition") {
    return {
      type: "new_runtime_abstraction",
      detail: "Add a build-order condition field and a defined stalled-game predicate.",
    };
  }

  if (row.classification === "multi_action") {
    return {
      type: row.status === "independent_existing_sibling"
        ? "source_owner_confirmation"
        : "new_runtime_abstraction",
      detail: row.status === "independent_existing_sibling"
        ? "Confirm that this complete comma-separated source step may be split only after its unresolved sibling semantics are preserved."
        : "Add a typed action for the source advice, condition, scouting, or attack instruction before splitting the step.",
    };
  }

  if (row.classification === "strategic_instruction") {
    return {
      type: row.status === "ambiguous_existing_upgrade"
        ? "source_owner_confirmation"
        : "new_runtime_abstraction",
      detail: row.status === "ambiguous_existing_upgrade"
        ? "Confirm that the informal Overlord-speed instruction means the canonical Pneumatized Carapace upgrade."
        : "Add an Oracle-harassment action with an enemy-worker target and safety policy.",
    };
  }

  throw new Error(`Unsupported semantic classification for ${action}`);
}

function indexProposalRows(proposal, classification) {
  return new Map(proposal.rows.map(row => [
    row.precondition.sourceRowDigest,
    { ...row, classification },
  ]));
}

async function buildSemanticRepairLedger() {
  // Each underlying audit temporarily suppresses expected parser warnings. Run them
  // serially so their temporary console handlers cannot overlap.
  const screen = await buildSuffixSemanticLossScreen();
  const location = await buildLocationSemanticsProposal();
  const count = await buildCountSemanticsProposal();
  const condition = await buildConditionSemanticsProposal();
  const multiAction = await buildMultiActionSemanticsProposal();
  const strategic = await buildStrategicSemanticsProposal();
  const proposalRows = new Map();

  for (const [classification, proposal] of Object.entries({
    location,
    count,
    condition,
    multi_action: multiAction,
    strategic_instruction: strategic,
  })) {
    for (const [digest, row] of indexProposalRows(proposal, classification)) {
      if (proposalRows.has(digest)) {
        throw new Error(`Duplicate semantic proposal for source digest ${digest}`);
      }
      proposalRows.set(digest, row);
    }
  }

  const rows = screen.rows.map(screenRow => {
    const digest = screenRow.precondition.sourceRowDigest;
    const proposalRow = proposalRows.get(digest);
    if (!proposalRow) {
      throw new Error(`Missing semantic proposal for source digest ${digest}`);
    }
    if (proposalRow.classification !== screenRow.classification) {
      throw new Error(`Semantic classification mismatch for source digest ${digest}`);
    }

    const requiredUnlock = determineRequiredUnlock(proposalRow);
    return {
      sourceRow: proposalRow.sourceRow,
      precondition: proposalRow.precondition,
      commentary: proposalRow.commentary,
      classification: proposalRow.classification,
      status: proposalRow.status,
      runtimeConcept: proposalRow.runtimeConcept,
      requiredUnlock,
      canonicalWrites: 0,
    };
  });
  const byClassification = {};
  const byRequiredUnlock = {};

  for (const row of rows) {
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
    byRequiredUnlock[row.requiredUnlock.type] = (byRequiredUnlock[row.requiredUnlock.type] || 0) + 1;
  }

  return {
    mode: "read_only_semantic_repair_ledger",
    sourceAudit: screen.sourceAudit,
    sourceScreenMode: screen.mode,
    summary: {
      screenedRows: screen.summary.screenedRows,
      ledgerRows: rows.length,
      byClassification,
      byRequiredUnlock,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildSemanticRepairLedger()
    .then(ledger => process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order semantic repair ledger failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildSemanticRepairLedger,
  determineRequiredUnlock,
};
