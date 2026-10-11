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
});
