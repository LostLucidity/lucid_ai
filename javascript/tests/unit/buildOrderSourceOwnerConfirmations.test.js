const {
  buildSourceOwnerConfirmationReport,
} = require("../../scripts/build-build-order-source-owner-confirmations");

describe("build-order source-owner confirmation report", () => {
  it("prepares exactly the ambiguous rows without sending or writing", async () => {
    const report = await buildSourceOwnerConfirmationReport();

    expect(report).toEqual(expect.objectContaining({
      mode: "read_only_source_owner_confirmation_report",
      sourceLedgerMode: "read_only_semantic_repair_ledger",
      summary: {
        confirmationRows: 3,
        canonicalWrites: 0,
        externalMessagesSent: 0,
      },
    }));
    expect(report.confirmations.map(row => row.sourceRow.action)).toEqual([
      "Photon Cannon at third base",
      "Photon Cannon at  fourth base",
      "Overlord Mejora el speed para hacer mejor los Nydus.",
    ]);
    report.confirmations.forEach(row => {
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.confirmationRequired).toEqual(expect.any(String));
      expect(row.canonicalWrites).toBe(0);
    });
  });
});
