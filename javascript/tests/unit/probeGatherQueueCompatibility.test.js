const { Ability, UnitType } = require("@node-sc2/core/constants");

const { queueGatherOrdersForProbes } = require("../../src/starcraftBot");

describe("Probe gather queue compatibility", () => {
  it("does not queue SMART for two probes whose Assimilator build orders outlive construction", () => {
    const mineralField = {
      pos: { x: 11, y: 10 },
      tag: "mineral-1",
    };
    const completedAssimilators = [{
      buildProgress: 1,
      pos: { x: 10, y: 10 },
    }];
    const probes = ["probe-1", "probe-2"].map(tag => ({
      labels: new Map(),
      orders: [{ abilityId: Ability.BUILD_ASSIMILATOR }],
      pos: { x: 10, y: 10 },
      tag,
      unitType: UnitType.PROBE,
    }));
    const units = {
      getBases: () => [],
      getByType: () => completedAssimilators,
      getClosest: () => [mineralField],
      getMineralFields: () => [mineralField],
    };
    const resources = {
      get: () => ({ units }),
    };
    const actions = [];

    queueGatherOrdersForProbes(units, probes, resources, actions);

    expect(actions).toEqual([]);
  });

  it("still queues one mineral command for a probe beside an active Assimilator warpin", () => {
    const mineralField = {
      pos: { x: 11, y: 10 },
      tag: "mineral-1",
    };
    const probe = {
      labels: new Map(),
      orders: [{ abilityId: Ability.BUILD_ASSIMILATOR }],
      pos: { x: 10, y: 10 },
      tag: "probe-1",
      unitType: UnitType.PROBE,
    };
    const units = {
      getBases: () => [],
      getByType: () => [{
        buildProgress: 0.5,
        pos: { x: 10, y: 11 },
      }],
      getClosest: () => [mineralField],
      getMineralFields: () => [mineralField],
    };
    const resources = {
      get: () => ({ units }),
    };
    const actions = [];

    queueGatherOrdersForProbes(units, [probe], resources, actions);

    expect(actions).toEqual([{
      abilityId: Ability.SMART,
      queueCommand: true,
      targetUnitTag: "mineral-1",
      unitTags: ["probe-1"],
    }]);
  });
});
