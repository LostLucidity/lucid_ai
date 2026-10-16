"use strict";

const {
  buildSemanticRepairLedger,
} = require("./build-build-order-semantic-repair-ledger");

async function buildSourceOwnerConfirmationReport() {
  const ledger = await buildSemanticRepairLedger();
  const confirmations = ledger.rows
    .filter(row => row.requiredUnlock.type === "source_owner_confirmation")
    .map(row => ({
      sourceRow: row.sourceRow,
      precondition: row.precondition,
      runtimeConcept: row.runtimeConcept,
      confirmationRequired: row.requiredUnlock.detail,
      canonicalWrites: 0,
    }));

  return {
    mode: "read_only_source_owner_confirmation_report",
    sourceAudit: ledger.sourceAudit,
    sourceLedgerMode: ledger.mode,
    summary: {
      confirmationRows: confirmations.length,
      canonicalWrites: 0,
      externalMessagesSent: 0,
    },
    confirmations,
  };
}

if (require.main === module) {
  buildSourceOwnerConfirmationReport()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      console.error(`Build-order source-owner confirmation report failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { buildSourceOwnerConfirmationReport };
