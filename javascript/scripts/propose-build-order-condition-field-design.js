"use strict";

const {
  buildConditionSemanticsProposal,
} = require("./propose-build-order-condition-semantics");

const CONDITION_FIELD_CONTRACT = Object.freeze({
  field: "condition",
  location: "optional BuildOrderStep property",
  acceptedShape: {
    kind: "stalled_game_v1",
    windowSeconds: "positive integer",
    minimumNoProgressSeconds: "positive integer less than or equal to windowSeconds",
  },
  parserRule: "Only an explicit typed condition object is accepted; comments and action suffixes are never inferred into conditions.",
  backwardCompatibility: "A missing condition preserves the current unconditional step behavior.",
});

const EVALUATION_CONTRACT = Object.freeze({
  interface: "evaluateBuildOrderCondition(world, condition) => satisfied | unsatisfied | unknown",
  executionRule: "Only satisfied releases a condition-bearing step; unsatisfied and unknown preserve the step without issuing its action.",
  stalledGameInputs: [
    "explicitly defined progress signals",
    "observation window in seconds",
    "minimum no-progress duration",
  ],
  nonGoals: [
    "No natural-language interpretation",
    "No inferred combat, scouting, or Nydus behavior",
    "No change to condition-free step execution",
  ],
});

const REQUIRED_REGRESSIONS = Object.freeze([
  "A legacy step without condition produces the same interpreted action and execution eligibility as before.",
  "A typed stalled_game_v1 condition survives build-order loading and strategy conversion unchanged.",
  "An unknown condition result emits no plan-step action and leaves the step pending.",
  "An unsatisfied condition result emits no plan-step action and leaves the step pending.",
  "Malformed or unsupported condition objects fail closed during validation without deriving a condition from comments or action text.",
]);

async function buildConditionFieldDesignProposal() {
  const proposal = await buildConditionSemanticsProposal();
  const sourceRows = proposal.rows.map(row => ({
    sourceRow: row.sourceRow,
    precondition: row.precondition,
    commentary: row.commentary,
    currentStatus: row.status,
    requiredUnlock: "A typed condition field plus a defined stalled_game_v1 predicate.",
  }));

  return {
    mode: "read_only_condition_field_design_proposal",
    sourceAudit: proposal.sourceAudit,
    sourceProposalMode: proposal.mode,
    summary: {
      sourceConditionRows: sourceRows.length,
      canonicalWrites: 0,
      runtimeWrites: 0,
      sourceOwnerConfirmationRequired: true,
    },
    conditionFieldContract: CONDITION_FIELD_CONTRACT,
    evaluationContract: EVALUATION_CONTRACT,
    requiredRegressions: REQUIRED_REGRESSIONS,
    sourceRows,
  };
}

if (require.main === module) {
  buildConditionFieldDesignProposal()
    .then(proposal => process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order condition-field design proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildConditionFieldDesignProposal,
};
