const {
  buildStrategicSemanticsProposal,
  proposeStrategicSemantics,
} = require("../../scripts/propose-build-order-strategic-semantics");

describe("build-order strategic semantics proposal", () => {
  let proposal;

  beforeAll(async () => {
    proposal = await buildStrategicSemanticsProposal();
  });

  it("keeps every strategic-instruction row out of canonical apply", () => {
    expect(proposal).toEqual(expect.objectContaining({
      mode: "read_only_strategic_semantics_proposal",
      sourceScreenMode: "semantic_loss_screen",
      sourceAudit: "data/buildOrders/scripts/scrapedBuildOrders.json",
      activeRuntimeStrategyConcepts: expect.arrayContaining([
        expect.objectContaining({ name: "pneumatized_carapace" }),
      ]),
      summary: {
        strategicInstructionRows: 2,
        representableRows: 0,
        byStatus: {
          unsupported: 1,
          ambiguous_existing_upgrade: 1,
        },
        canonicalWrites: 0,
      },
    }));
    proposal.rows.forEach(row => {
      expect(row.canonicalWrites).toBe(0);
      expect(row.precondition.sourceRowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.status).not.toBe("representable");
    });
  });

  it("does not mistake Oracle harassment for an active strategy action", () => {
    const find = action => proposal.rows.find(row => row.sourceRow.action === action);

    expect(find("Oracle (Chrono Boost) you can try to kill some drones with oracles")).toEqual(
      expect.objectContaining({
        status: "unsupported",
        runtimeConcept: null,
      })
    );
  });

  it("keeps informal Overlord-speed wording ambiguous despite the existing upgrade", () => {
    expect(proposeStrategicSemantics({
      sourceRow: { action: "Overlord Mejora el speed" },
      commentary: { sourceSuffix: "Mejora el speed para hacer mejor los Nydus." },
    })).toEqual({
      status: "ambiguous_existing_upgrade",
      runtimeConcept: "pneumatized_carapace",
      rationale: "Pneumatized Carapace is the active Overlord-speed upgrade mapping, but the source does not name the canonical upgrade action and cannot be rewritten by inference.",
    });
  });
});
