const fs = require("fs");
const path = require("path");
const { Ability, UnitType } = require("@node-sc2/core/constants");

const { gather } = require("../../src/gameLogic/economy/workerAssignment");
const { setPendingOrders, unitPendingOrders } = require("../../src/units/management/unitOrders");
const { getActionProvenance, setActionProvenance } = require("../../src/utils/actionProvenance");
const { executeActions } = require("../../src/starcraftBot");

describe("gather action provenance", () => {
  it("keeps provenance out of the serialized SC2 action", () => {
    const action = { abilityId: Ability.SMART, unitTags: ["probe-1"] };

    setActionProvenance(action, "test.source");

    expect(getActionProvenance(action)).toBe("test.source");
    expect(Object.keys(action)).toEqual(["abilityId", "unitTags"]);
    expect(JSON.stringify(action)).not.toContain("test.source");
  });

  it("associates the supplied caller with a gather-generated action", () => {
    const worker = {
      labels: new Map(),
      orders: [],
      pos: { x: 10, y: 10 },
      tag: "probe-1",
    };
    const mineralField = {
      pos: { x: 11, y: 10 },
      tag: "mineral-1",
    };
    const resources = {
      get: () => ({ units: { getBases: () => [] } }),
    };

    const [action] = gather(resources, worker, mineralField, false, "test.gatherCaller");

    expect(getActionProvenance(action)).toBe("test.gatherCaller");
  });

  it("logs local provenance and clears pending orders when SC2 rejects an action", async () => {
    const action = {
      abilityId: Ability.SMART,
      targetUnitTag: "mineral-1",
      unitTags: ["probe-1"],
    };
    setActionProvenance(action, "test.failureCaller");
    const worker = { unitType: UnitType.PROBE };
    setPendingOrders(worker, action);
    const units = {
      getAll: () => [worker],
      getByTag: () => worker,
    };
    const world = {
      resources: {
        get: () => ({
          actions: { sendAction: async () => ({ result: [3] }) },
          units,
        }),
      },
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await executeActions(world, [action]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Source: test.failureCaller"));
    expect(unitPendingOrders.has(worker)).toBe(false);
    errorSpy.mockRestore();
  });

  it("labels every active gather caller", () => {
    const expectedCallers = [
      ["src/starcraftBot.js", '"starcraftBot.handleIdleProbesNearWarpingAssimilators"'],
      ["src/starcraftBot.js", '"starcraftBot.queueGatherOrdersForProbes"'],
      ["src/gameLogic/economy/economyManagement.js", '"economyManagement.moveWorkerToMinerals"'],
      ["src/gameLogic/economy/workerAssignment.js", '"workerAssignment.assignWorkerToMineralField"'],
      ["src/gameLogic/economy/workerAssignment.js", '"workerAssignment.assignWorkerToField.currentAssignment"'],
      ["src/gameLogic/economy/workerAssignment.js", '"workerAssignment.assignWorkerToField.neediestField"'],
      ["src/gameLogic/economy/workerAssignment.js", '"workerAssignment.reassignIdleWorkers"'],
    ];

    expectedCallers.forEach(([relativePath, source]) => {
      const file = fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8");
      expect(file).toContain(source);
    });
  });
});
