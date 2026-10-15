"use strict";

const {
  buildSuffixSemanticLossScreen,
} = require("./screen-build-order-suffix-semantics");

const ACTIVE_RUNTIME_CONCEPTS = Object.freeze([
  {
    name: "natural_wall",
    evidence: "src/features/construction/buildingPlacement.js",
    limitation: "Provides natural-wall candidate positions, not a generic natural-expansion build-order target.",
  },
  {
    name: "main_ramp",
    evidence: "src/features/construction/buildingPlacement.js",
    limitation: "Provides main-ramp candidates, not a generic main-base placement target.",
  },
  {
    name: "next_safe_expansion",
    evidence: "src/features/construction/buildingService.js",
    limitation: "Selects the next safe expansion without preserving ordinal labels such as third or fourth.",
  },
  {
    name: "enemy_main_and_natural",
    evidence: "src/utils/scoutingUtils.js",
    limitation: "Available for scouting, with no active construction-target binding.",
  },
]);

function proposeLocationSemantics(row) {
  const suffix = row.commentary.sourceSuffix;

  if (/\bnatural\b/i.test(suffix)) {
    return {
      status: "ambiguous_existing_concept",
      runtimeConcept: "natural_wall",
      rationale: "The active map API can identify the natural, but build-order construction has no generic natural-expansion target field.",
    };
  }

  if (/\b(?:third|fourth)\b/i.test(suffix)) {
    return {
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The active expansion selector does not preserve ordinal expansion targets.",
    };
  }

  if (/\b(?:enemy|inside)\b/i.test(suffix)) {
    return {
      status: "unsupported",
      runtimeConcept: "enemy_main_and_natural",
      rationale: "Enemy locations are scouting concepts only; no active construction-target binding exists.",
    };
  }

  if (/\bmain\b/i.test(suffix)) {
    return {
      status: "unsupported",
      runtimeConcept: "main_ramp",
      rationale: "Main-ramp placement candidates are not a generic main-base target and do not encode the source instruction.",
    };
  }

  return {
    status: "unsupported",
    runtimeConcept: null,
    rationale: "No exact active runtime location concept represents this base-relative instruction.",
  };
}

async function buildLocationSemanticsProposal() {
  const screen = await buildSuffixSemanticLossScreen();
  const rows = screen.rows
    .filter(row => row.classification === "location")
    .map(row => ({
      sourceRow: row.sourceRow,
      precondition: row.precondition,
      commentary: row.commentary,
      ...proposeLocationSemantics(row),
      canonicalWrites: 0,
    }));
  const byStatus = {};

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }

  return {
    mode: "read_only_location_semantics_proposal",
    sourceAudit: screen.sourceAudit,
    sourceScreenMode: screen.mode,
    activeRuntimeConcepts: ACTIVE_RUNTIME_CONCEPTS,
    summary: {
      locationRows: rows.length,
      representableRows: rows.filter(row => row.status === "representable").length,
      byStatus,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildLocationSemanticsProposal()
    .then(proposal => process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order location semantics proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildLocationSemanticsProposal,
  proposeLocationSemantics,
};
