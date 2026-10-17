"use strict";

const {
  buildSuffixSemanticLossScreen,
} = require("./screen-build-order-suffix-semantics");

const ACTIVE_RUNTIME_STRATEGY_CONCEPTS = Object.freeze([
  {
    name: "pneumatized_carapace",
    evidence: "data/gameData/actionMappings.json maps Pneumatized Carapace to OVERLORDSPEED",
    limitation: "The source suffix describes Overlord speed informally and is not an exact canonical upgrade action.",
  },
  {
    name: "scv_scouting",
    evidence: "src/features/strategy/specialActions.js",
    limitation: "The only active scouting special action is SCV scouting; it does not command Oracle harassment.",
  },
  {
    name: "nydus_network_construction",
    evidence: "src/features/actions/unitActionUtils.js buildWithNydusNetwork",
    limitation: "Builds a Nydus structure at a selected position; it does not move units through tunnels or create harassment plays.",
  },
]);

function proposeStrategicSemantics(row) {
  const suffix = row.commentary.sourceSuffix;

  if (/\b(?:overlord|ovie)\b/i.test(row.sourceRow.action) && /\b(?:speed|mejora)\b/i.test(suffix)) {
    return {
      status: "ambiguous_existing_upgrade",
      runtimeConcept: "pneumatized_carapace",
      rationale: "Pneumatized Carapace is the active Overlord-speed upgrade mapping, but the source does not name the canonical upgrade action and cannot be rewritten by inference.",
    };
  }

  if (/\b(?:oracle|oracles)\b/i.test(row.sourceRow.action) && /\b(?:kill|drones)\b/i.test(suffix)) {
    return {
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The active build-order strategy path has no Oracle-harassment action or enemy-worker target binding.",
    };
  }

  return {
    status: "unsupported",
    runtimeConcept: null,
    rationale: "No exact active runtime strategy concept represents this source instruction.",
  };
}

async function buildStrategicSemanticsProposal() {
  const screen = await buildSuffixSemanticLossScreen();
  const rows = screen.rows
    .filter(row => row.classification === "strategic_instruction")
    .map(row => ({
      sourceRow: row.sourceRow,
      precondition: row.precondition,
      commentary: row.commentary,
      ...proposeStrategicSemantics(row),
      canonicalWrites: 0,
    }));
  const byStatus = {};

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }

  return {
    mode: "read_only_strategic_semantics_proposal",
    sourceAudit: screen.sourceAudit,
    sourceScreenMode: screen.mode,
    activeRuntimeStrategyConcepts: ACTIVE_RUNTIME_STRATEGY_CONCEPTS,
    summary: {
      strategicInstructionRows: rows.length,
      representableRows: 0,
      byStatus,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildStrategicSemanticsProposal()
    .then(proposal => process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order strategic semantics proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildStrategicSemanticsProposal,
  proposeStrategicSemantics,
};
