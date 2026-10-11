const { Ability } = require("@node-sc2/core/constants");
const { gatheringAbilities } = require("@node-sc2/core/constants/groups");

jest.mock("../../src/gameLogic/economy/workerService", () => ({
  isMoving: jest.fn(() => false),
  isWorkerReservedForBuilding: jest.fn(() => false),
}));

jest.mock("../../src/features/pathfinding/pathfinding", () => ({
  getClosestUnitFromUnit: jest.fn(),
  getClosestExpansion: jest.fn(() => ({})),
}));

const { assignWorkersToMinerals, gather } = require("../../src/gameLogic/economy/workerAssignment");
const { getMineralFieldAssignments } = require("../../src/utils/resourceUtils");

describe("worker assignment node-sc2 compatibility", () => {
  it("counts gathering and returning mineral workers without isHarvesting", () => {
    const mineralField = {
      labels: new Map(),
      mineralContents: 1800,
      tag: "mineral-1",
    };
    const gatheringWorker = {
      isGathering: jest.fn(type => type === "minerals"),
      isReturning: jest.fn(() => false),
      labels: new Map([["mineralField", mineralField]]),
      orders: [],
    };
    const returningWorker = {
      isGathering: jest.fn(() => false),
      isReturning: jest.fn(() => true),
      labels: new Map([["mineralField", mineralField]]),
      orders: [],
    };
    const units = {
      getWorkers: () => [gatheringWorker, returningWorker],
    };

    expect(getMineralFieldAssignments(units, [mineralField])).toEqual([{
      count: 2,
      mineralContents: 1800,
      mineralFieldTag: "mineral-1",
      targetedCount: 0,
    }]);
    expect(gatheringWorker.isGathering).toHaveBeenCalledWith("minerals");
    expect(returningWorker.isReturning).toHaveBeenCalled();
  });

  it("does not query visibility before the node-sc2 visibility grid is initialized", () => {
    const worker = {
      isGathering: jest.fn(() => true),
      labels: new Map(),
      orders: [{ abilityId: gatheringAbilities[0] }],
      pos: { x: 10, y: 10 },
      tag: 1,
    };
    const base = { pos: { x: 10, y: 10 } };
    const mineralField = {
      labels: new Map(),
      pos: { x: 11, y: 10 },
      tag: "mineral-1",
    };
    const map = {
      _mapState: { visibility: null },
      isVisible: jest.fn(() => {
        throw new TypeError("visibility grid is not initialized");
      }),
    };
    const units = {
      getBases: () => [base],
      getClosest: () => [base],
      getMineralFields: () => [mineralField],
      getWorkers: () => [worker],
    };
    const resources = {
      get: () => ({ map, units }),
    };

    expect(assignWorkersToMinerals(resources)).toEqual([]);
    expect(map.isVisible).not.toHaveBeenCalled();
  });

  it("does not issue SMART to a stale assigned mineral field", () => {
    const staleMineralField = {
      labels: new Map([["workerCount", 1]]),
      pos: { x: 11, y: 10 },
      tag: "mineral-stale",
    };
    const liveMineralField = {
      labels: new Map(),
      mineralContents: 1800,
      pos: { x: 12, y: 10 },
      tag: "mineral-live",
    };
    const worker = {
      isGathering: jest.fn(type => type === "minerals"),
      labels: new Map([["mineralField", staleMineralField]]),
      orders: [{
        abilityId: Ability.HARVEST_GATHER_PROBE,
        targetUnitTag: liveMineralField.tag,
      }],
      pos: { x: 10, y: 10 },
      tag: "probe-1",
    };
    const base = { pos: { x: 10, y: 10 } };
    const map = {
      _mapState: { visibility: {} },
      isVisible: jest.fn(() => true),
    };
    const units = {
      getBases: () => [base],
      getByTag: tag => tag === staleMineralField.tag ? staleMineralField : liveMineralField,
      getClosest: () => [base],
      getMineralFields: () => [liveMineralField],
      getWorkers: () => [worker],
    };
    const resources = {
      get: () => ({ map, units }),
    };

    expect(assignWorkersToMinerals(resources)).toEqual([]);
    expect(worker.labels.has("mineralField")).toBe(false);
  });

  it("does not append the same queued mineral gather command twice in one frame", () => {
    const worker = {
      labels: new Map(),
      orders: [{ abilityId: Ability.BUILD_ASSIMILATOR }],
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

    expect(gather(resources, worker, mineralField, true)).toEqual([{
      abilityId: Ability.SMART,
      queueCommand: true,
      targetUnitTag: "mineral-1",
      unitTags: ["probe-1"],
    }]);
    expect(gather(resources, worker, mineralField, true)).toEqual([]);
  });

  it("does not requeue a mineral gather command already behind a build order", () => {
    const worker = {
      labels: new Map(),
      orders: [
        { abilityId: Ability.BUILD_ASSIMILATOR },
        { abilityId: Ability.HARVEST_GATHER, targetUnitTag: "mineral-1" },
      ],
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

    expect(gather(resources, worker, mineralField, true)).toEqual([]);
    expect(gather(resources, worker, {
      pos: { x: 12, y: 10 },
      tag: "mineral-2",
    }, true)).toEqual([{
      abilityId: Ability.SMART,
      queueCommand: true,
      targetUnitTag: "mineral-2",
      unitTags: ["probe-1"],
    }]);
  });

});
