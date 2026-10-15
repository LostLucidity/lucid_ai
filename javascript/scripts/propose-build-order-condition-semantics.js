"use strict";

const {
  buildSuffixSemanticLossScreen,
} = require("./screen-build-order-suffix-semantics");

const ACTIVE_RUNTIME_CONDITION_INTERFACE = Object.freeze({
  buildOrderStepSchema: "supply, time, action, interpretedAction, comment, completed",
  planStepFields: "supply, time, action, orderType, unitType, targetCount, upgrade, isChronoBoosted, count, candidatePositions, food",
  completionChecks: "unit target counts and upgrade completion",
  evidence: [
    "src/core/globalTypes.js BuildOrderStep",
    "src/features/strategy/strategyManager.js createPlanStep",
    "src/features/strategy/strategyManager.js isStepSatisfied",
  ],
  limitation: "No build-order condition field or runtime predicate represents a strategic state such as a stalled game.",
});

function proposeConditionSemantics(row) {
  const suffix = row.commentary.sourceSuffix;

  if (/\b(?:si|if)\s+la\s+partida\s+se\s+estanca|\bgame\s+stagnates\b/i.test(suffix)) {
    return {
      status: "unsupported",
      runtimeConcept: null,
      rationale: "The source is a strategic response to a stalled game; the active build-order model has no condition field or stalled-game predicate.",
    };
  }

  return {
    status: "unsupported",
    runtimeConcept: null,
    rationale: "No exact active build-order condition interface represents this source instruction.",
  };
}

async function buildConditionSemanticsProposal() {
  const screen = await buildSuffixSemanticLossScreen();
  const rows = screen.rows
    .filter(row => row.classification === "condition")
    .map(row => ({
      sourceRow: row.sourceRow,
      precondition: row.precondition,
      commentary: row.commentary,
      ...proposeConditionSemantics(row),
      canonicalWrites: 0,
    }));
  const byStatus = {};

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }

  return {
    mode: "read_only_condition_semantics_proposal",
    sourceAudit: screen.sourceAudit,
    sourceScreenMode: screen.mode,
    activeRuntimeConditionInterface: ACTIVE_RUNTIME_CONDITION_INTERFACE,
    summary: {
      conditionRows: rows.length,
      representableRows: rows.filter(row => row.status === "representable").length,
      byStatus,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildConditionSemanticsProposal()
    .then(proposal => process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order condition semantics proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildConditionSemanticsProposal,
  proposeConditionSemantics,
};
