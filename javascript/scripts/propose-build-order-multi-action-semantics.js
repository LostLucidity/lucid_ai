"use strict";

const {
  buildSuffixSemanticLossScreen,
} = require("./screen-build-order-suffix-semantics");
const {
  interpretBuildOrderAction,
} = require("../data/buildOrders/scripts/buildOrderUtils");

const ACTIVE_RUNTIME_MULTI_ACTION_INTERFACE = Object.freeze({
  syntax: "comma-separated action parts",
  parsing: "interpretBuildOrderAction splits the complete action string on commas",
  execution: "StrategyManager tracks completion for every interpreted action in a step",
  evidence: [
    "data/buildOrders/scripts/buildOrderUtils.js interpretBuildOrderAction",
    "src/features/strategy/strategyManager.js processStep",
  ],
  limitation: "Every comma-separated part must resolve; it does not preserve advisory text as an executable action.",
});

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

function proposeMultiActionSemantics(row) {
  const actionParts = row.sourceRow.sourceAction.split(",").map(part => part.trim());
  const siblings = actionParts
    .map((actionPart, actionPartIndex) => ({ actionPart, actionPartIndex }))
    .filter(sibling => sibling.actionPartIndex !== row.sourceRow.actionPartIndex)
    .map(sibling => ({
      ...sibling,
      interpretedActions: interpretSilently(sibling.actionPart),
    }));
  const independentlyExecutableSiblings = siblings.filter(sibling =>
    sibling.interpretedActions.length > 0 &&
    sibling.interpretedActions.every(isResolvedAction)
  );

  if (independentlyExecutableSiblings.length > 0) {
    return {
      status: "independent_existing_sibling",
      runtimeConcept: "comma-separated action parts",
      independentlyExecutableSiblings,
      rationale: "A sibling source part resolves through the active multi-action parser, but the current row still contains unsupported semantics and cannot be rewritten automatically.",
    };
  }

  return {
    status: "no_independent_existing_sibling",
    runtimeConcept: "comma-separated action parts",
    independentlyExecutableSiblings: [],
    rationale: "No sibling source part is independently executable through the active multi-action parser.",
  };
}

async function buildMultiActionSemanticsProposal() {
  const screen = await buildSuffixSemanticLossScreen();
  const rows = screen.rows
    .filter(row => row.classification === "multi_action")
    .map(row => ({
      sourceRow: row.sourceRow,
      precondition: row.precondition,
      commentary: row.commentary,
      ...proposeMultiActionSemantics(row),
      canonicalWrites: 0,
    }));
  const byStatus = {};

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }

  return {
    mode: "read_only_multi_action_semantics_proposal",
    sourceAudit: screen.sourceAudit,
    sourceScreenMode: screen.mode,
    activeRuntimeMultiActionInterface: ACTIVE_RUNTIME_MULTI_ACTION_INTERFACE,
    summary: {
      multiActionRows: rows.length,
      independentlyExecutableSiblingRows: rows.filter(
        row => row.status === "independent_existing_sibling"
      ).length,
      representableRows: 0,
      byStatus,
      canonicalWrites: 0,
    },
    rows,
  };
}

if (require.main === module) {
  buildMultiActionSemanticsProposal()
    .then(proposal => process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order multi-action semantics proposal failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildMultiActionSemanticsProposal,
  proposeMultiActionSemantics,
};
