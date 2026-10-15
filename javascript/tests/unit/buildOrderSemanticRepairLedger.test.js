const {
  buildSemanticRepairLedger,
  determineRequiredUnlock,
} = require("../../scripts/build-build-order-semantic-repair-ledger");

describe("build-order semantic repair ledger", () => {
  let ledger;

  beforeAll(async () => {
    ledger = await buildSemanticRepairLedger();
  });

  it("accounts for every screened row without canonical writes", () => {
    expect(ledger).toEqual(expect.objectContaining({
      mode: "read_only_semantic_repair_ledger",
      sourceScreenMode: "semantic_loss_screen",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      summary: {
        screenedRows: 26,
        ledgerRows: 26,
        byClassification: {
          location: 10,
          count: 8,
          condition: 1,
          multi_action: 5,
          strategic_instruction: 2,
        },
        byRequiredUnlock: {
          new_runtime_abstraction: 22,
          explicit_scope_decision: 1,
          source_owner_confirmation: 3,
        },
        canonicalWrites: 0,
      },
    }));
    ledger.rows.forEach(row => {
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.requiredUnlock).toEqual(expect.objectContaining({
        type: expect.any(String),
        detail: expect.any(String),
      }));
      expect(row.canonicalWrites).toBe(0);
    });
  });

  it("keeps source-owner confirmation separate from missing abstractions", () => {
    const find = action => ledger.rows.find(row => row.sourceRow.action === action);

    expect(find("Photon Cannon at third base").requiredUnlock.type).toBe(
      "source_owner_confirmation"
    );
    expect(find("Overlord Mejora el speed para hacer mejor los Nydus.").requiredUnlock.type).toBe(
      "source_owner_confirmation"
    );
    expect(find("Oracle (Chrono Boost) you can try to kill some drones with oracles").requiredUnlock.type).toBe(
      "new_runtime_abstraction"
    );
  });

  it("requires a defined stalled-game predicate instead of inferred behavior", () => {
    expect(determineRequiredUnlock({
      classification: "condition",
      sourceRow: { action: "Nydus Network" },
      commentary: { sourceSuffix: "if the game stagnates" },
      status: "unsupported",
    })).toEqual({
      type: "new_runtime_abstraction",
      detail: "Add a build-order condition field and a defined stalled-game predicate.",
    });
  });

  it("suppresses expected unresolved-action warnings while building the ledger", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await buildSemanticRepairLedger();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
